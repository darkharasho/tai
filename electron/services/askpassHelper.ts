import * as fs from 'fs';
import * as path from 'path';

/** Per-run directory name prefix under the temp dir. */
export const ASKPASS_DIR_PREFIX = 'tai-askpass-';
/** File inside that directory holding the owning TAI main-process pid. */
export const ASKPASS_OWNER_FILE = 'owner.pid';

/**
 * sudo takes SUDO_ASKPASS as a bare path with no arguments, so the helper is a
 * sh wrapper that execs TAI's own Electron binary as Node. `exec` keeps the pid,
 * which matters: the broker checks the parent of the pid the helper reports,
 * and that must be sudo, not an intermediate shell.
 */
export function generateAskpassWrapper(execPath: string, helperPath: string): string {
  return `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec ${shQuote(execPath)} ${shQuote(helperPath)} "$@"\n`;
}

function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * The helper is untrusted — the AI can read, run or rewrite it. It only reports
 * who it is and relays the broker's answer; every decision is in the broker.
 */
export function generateAskpassHelperScript(socketPath: string): string {
  return `'use strict';
const net = require('net');
const SOCKET = ${JSON.stringify(socketPath)};
let settled = false;
function exit(code) { if (!settled) { settled = true; process.exit(code); } }
const sock = net.createConnection(SOCKET);
sock.setEncoding('utf8');
sock.on('connect', () => {
  sock.write(JSON.stringify({
    pid: process.pid,
    key: process.env.TAI_ASKPASS_KEY || '',
    prompt: process.argv[2] || '',
  }) + '\\n');
});
let buf = '';
sock.on('data', (chunk) => {
  buf += chunk;
  const nl = buf.indexOf('\\n');
  if (nl < 0) return;
  let reply = null;
  try { reply = JSON.parse(buf.slice(0, nl)); } catch {}
  if (!reply || reply.ok !== true || typeof reply.secret !== 'string') return exit(1);
  settled = true;
  process.stdout.write(reply.secret + '\\n', () => process.exit(0));
});
sock.on('error', () => exit(1));
sock.on('close', () => exit(1));
`;
}

/**
 * SHLVL is raised to at least 1 because a desktop-launched TAI has SHLVL=0, and
 * bash treats `bash -c` with a socket on stdin at that level as an ssh session:
 * it sources ~/.bashrc, where distro profile scripts (Bazzite's askpass.sh)
 * overwrite SUDO_ASKPASS with ksshaskpass before the AI's sudo ever runs.
 */
export function buildAskpassEnv(
  key: string,
  askpassPath: string | null,
  platform: NodeJS.Platform,
  shlvl: string | undefined = process.env.SHLVL,
): Record<string, string> {
  if (!askpassPath || (platform !== 'linux' && platform !== 'darwin')) return {};
  const level = Number.parseInt(shlvl ?? '', 10);
  return {
    SUDO_ASKPASS: askpassPath,
    TAI_ASKPASS_KEY: key,
    SHLVL: String(Number.isInteger(level) && level > 1 ? level : 1),
  };
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: the pid exists but belongs to someone else — treat as alive.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * A crashed run leaves its askpass directory behind. Remove ours whose owning
 * process is gone, but never one belonging to a live TAI (a dev build and the
 * packaged app can share a temp dir) or to another user.
 */
export function sweepStaleAskpassDirs(
  tempDir: string,
  isAlive: (pid: number) => boolean = pidAlive,
): string[] {
  const removed: string[] = [];
  let names: string[];
  try {
    names = fs.readdirSync(tempDir);
  } catch {
    return removed;
  }
  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  for (const name of names) {
    if (!name.startsWith(ASKPASS_DIR_PREFIX)) continue;
    const dir = path.join(tempDir, name);
    try {
      const st = fs.lstatSync(dir);
      if (!st.isDirectory() || (uid !== null && st.uid !== uid)) continue;
      let owner = Number.NaN;
      try {
        owner = Number.parseInt(fs.readFileSync(path.join(dir, ASKPASS_OWNER_FILE), 'utf8').trim(), 10);
      } catch { /* no owner file */ }
      if (Number.isInteger(owner) && owner > 0 && isAlive(owner)) continue;
      fs.rmSync(dir, { recursive: true, force: true });
      removed.push(name);
    } catch { /* best effort */ }
  }
  return removed;
}
