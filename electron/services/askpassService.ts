import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';
import { app, ipcMain, type BrowserWindow } from 'electron';
import { AskpassBroker } from './askpassBroker';
import { startAskpassServer } from './askpassServer';
import {
  ASKPASS_DIR_PREFIX, ASKPASS_OWNER_FILE, buildAskpassEnv, generateAskpassHelperScript,
  generateAskpassWrapper, sweepStaleAskpassDirs,
} from './askpassHelper';
import { resolveSudoParent } from './sudoParent';
import { credentialVault } from './credentialVault';

const PROMPT_TIMEOUT_MS = 5 * 60_000;

let broker: AskpassBroker | null = null;
let server: net.Server | null = null;
let dir: string | null = null;
let askpassPath: string | null = null;

/**
 * Routes sudo from AI tool processes (no tty → $SUDO_ASKPASS) to TAI's own
 * password field and session cache. Linux and macOS only: Windows sudo has no
 * askpass mechanism. The secret is returned over the private socket on both
 * platforms. If anything fails to start, AI sudo behaves as before.
 */
export async function setupAskpassService(getWindow: () => BrowserWindow | null): Promise<void> {
  if (process.platform !== 'linux' && process.platform !== 'darwin') return;

  const send = (channel: string, ...args: unknown[]) => {
    const win = getWindow();
    try {
      if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
    } catch { /* window gone */ }
  };

  broker = new AskpassBroker({
    resolveSudoParent: (pid) => resolveSudoParent(pid),
    vault: credentialVault,
    send,
    timeoutMs: PROMPT_TIMEOUT_MS,
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h as NodeJS.Timeout),
  });

  ipcMain.on('ai:sudo-answer', (_event, requestId: unknown, secret: unknown, remember: unknown) => {
    if (typeof requestId !== 'string' || typeof secret !== 'string') return;
    broker?.answer(requestId, secret, remember === true);
  });
  ipcMain.on('ai:sudo-cancel', (_event, requestId: unknown) => {
    if (typeof requestId === 'string') broker?.cancel(requestId);
  });

  try {
    const tempDir = app.getPath('temp');
    sweepStaleAskpassDirs(tempDir);
    dir = fs.mkdtempSync(path.join(tempDir, ASKPASS_DIR_PREFIX));
    fs.chmodSync(dir, 0o700);
    fs.writeFileSync(path.join(dir, ASKPASS_OWNER_FILE), String(process.pid), { mode: 0o600 });
    const socketPath = path.join(dir, 'broker.sock');
    const helperPath = path.join(dir, 'askpass.cjs');
    fs.writeFileSync(helperPath, generateAskpassHelperScript(socketPath), { mode: 0o700 });
    const wrapperPath = path.join(dir, 'askpass');
    fs.writeFileSync(wrapperPath, generateAskpassWrapper(process.execPath, helperPath), { mode: 0o700 });
    server = await startAskpassServer(broker, socketPath);
    askpassPath = wrapperPath;
  } catch (err) {
    console.warn('[askpass] unavailable:', err instanceof Error ? err.message : String(err));
    stopAskpassService();
  }
}

export function askpassEnvFor(key: string): Record<string, string> {
  return buildAskpassEnv(key, askpassPath, process.platform);
}

export function cancelAskpassForKey(key: string): void {
  broker?.cancelKey(key);
}

export function stopAskpassService(): void {
  askpassPath = null;
  broker?.cancelAll();
  try { server?.close(); } catch { /* already closed */ }
  server = null;
  if (dir) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
    dir = null;
  }
}
