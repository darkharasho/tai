import * as fs from 'fs';
import { execFileSync } from 'child_process';

/**
 * Is the process that spawned our askpass helper a real, root-privileged sudo?
 *
 * This is the whole trust boundary for AI sudo: the helper, its environment and
 * its socket are all reachable by the AI, so the main process decides who gets
 * a password by looking at the helper's parent. A user process cannot hold uid
 * 0 in any slot (real, effective, saved, fs), and a process that already does
 * is root, so faking the name `sudo` gains nothing.
 *
 * `/proc/<ppid>/exe` is deliberately not used: sudo is setuid and non-dumpable,
 * so readlink on it fails with EACCES for the invoking user.
 *
 * Fails closed: anything unreadable or unparseable is "not sudo".
 */

export interface ProcIdentity {
  name: string;
  uids: number[];
}

export function parsePpidFromStat(stat: string): number | null {
  const close = stat.lastIndexOf(')');
  if (close < 0) return null;
  // After "pid (comm) ": field 0 is state, field 1 is ppid.
  const fields = stat.slice(close + 2).split(' ');
  const ppid = Number.parseInt(fields[1] ?? '', 10);
  return Number.isInteger(ppid) && ppid > 1 ? ppid : null;
}

export function parseProcStatus(status: string): ProcIdentity | null {
  const name = /^Name:\t(.*)$/m.exec(status)?.[1];
  const uidLine = /^Uid:\s+(.*)$/m.exec(status)?.[1];
  if (name === undefined || uidLine === undefined) return null;
  const uids = uidLine.trim().split(/\s+/).map(Number);
  if (uids.length === 0 || uids.some((u) => !Number.isInteger(u))) return null;
  return { name, uids };
}

export function parsePsPpid(out: string): number | null {
  const ppid = Number.parseInt(out.trim(), 10);
  return Number.isInteger(ppid) && ppid > 1 ? ppid : null;
}

export function parsePsIdentity(out: string): ProcIdentity | null {
  const tokens = out.trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return null;
  const uids: number[] = [];
  while (tokens.length > 1 && /^\d+$/.test(tokens[tokens.length - 1])) {
    uids.unshift(Number(tokens.pop()));
  }
  if (uids.length === 0) return null;
  return { name: tokens.join(' '), uids };
}

export function isRootSudo(id: ProcIdentity | null): boolean {
  return !!id && id.name === 'sudo' && id.uids.includes(0);
}

export interface SudoParentDeps {
  platform: NodeJS.Platform;
  readFile(path: string): string;
  run(cmd: string, args: string[]): string;
}

const defaultDeps: SudoParentDeps = {
  platform: process.platform,
  readFile: (p) => fs.readFileSync(p, 'utf8'),
  run: (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', timeout: 2000 }),
};

/** The verified sudo pid that spawned `pid`, or null. */
export function resolveSudoParent(pid: number, deps: SudoParentDeps = defaultDeps): number | null {
  if (!Number.isInteger(pid) || pid <= 1) return null;
  try {
    if (deps.platform === 'linux') {
      const ppid = parsePpidFromStat(deps.readFile(`/proc/${pid}/stat`));
      if (ppid === null) return null;
      return isRootSudo(parseProcStatus(deps.readFile(`/proc/${ppid}/status`))) ? ppid : null;
    }
    if (deps.platform === 'darwin') {
      const ppid = parsePsPpid(deps.run('/bin/ps', ['-o', 'ppid=', '-p', String(pid)]));
      if (ppid === null) return null;
      const id = parsePsIdentity(deps.run('/bin/ps', ['-o', 'ucomm=,ruid=,uid=,svuid=', '-p', String(ppid)]));
      return isRootSudo(id) ? ppid : null;
    }
  } catch {
    return null;
  }
  return null;
}
