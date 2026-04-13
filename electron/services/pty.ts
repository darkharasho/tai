import * as pty from 'node-pty';
import { BrowserWindow, ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';

let hasSystemdRun: boolean | undefined;
function detectSystemdScope(): boolean {
  if (process.platform !== 'linux') return false;
  if (hasSystemdRun !== undefined) return hasSystemdRun;
  try {
    const { execFileSync } = require('child_process') as typeof import('child_process');
    execFileSync('systemd-run', ['--user', '--scope', '--', '/bin/true'], {
      stdio: 'ignore', timeout: 3000,
    });
    hasSystemdRun = true;
  } catch {
    hasSystemdRun = false;
  }
  return hasSystemdRun;
}

let canUseSystemdScope = detectSystemdScope;

const allTerminals = new Map<number, pty.IPty>();
let nextId = 1;

export function setupPtyService(getWindow: () => BrowserWindow | null) {
  function safeSend(channel: string, ...args: unknown[]) {
    const win = getWindow();
    try {
      if (win && !win.isDestroyed()) {
        win.webContents.send(channel, ...args);
      }
    } catch {}
  }

  ipcMain.handle('pty:create', (_event, cwd: string) => {
    const shell = process.env.SHELL || '/bin/bash';
    const id = nextId++;
    const env = { ...process.env } as Record<string, string>;
    delete env.GIO_LAUNCHED_DESKTOP_FILE;
    delete env.GIO_LAUNCHED_DESKTOP_FILE_PID;
    delete env.BAMF_DESKTOP_FILE_HINT;
    delete env.XDG_ACTIVATION_TOKEN;
    delete env.DESKTOP_STARTUP_ID;
    delete env.CHROME_DESKTOP;
    delete env.INVOCATION_ID;

    const useScope = canUseSystemdScope();
    const spawnCmd = useScope ? 'systemd-run' : shell;
    const spawnArgs = useScope
      ? ['--user', '--scope', '--quiet', '--', shell, '--login']
      : ['--login'];

    const term = pty.spawn(spawnCmd, spawnArgs, {
      name: 'xterm-256color',
      cwd: cwd || process.env.HOME || '/',
      env,
    });

    allTerminals.set(id, term);

    term.onData((data) => safeSend('pty:data', id, data));
    term.onExit(() => { allTerminals.delete(id); });

    return id;
  });

  ipcMain.on('pty:write', (_event, id: number, data: string) => {
    allTerminals.get(id)?.write(data);
  });

  ipcMain.on('pty:resize', (_event, id: number, cols: number, rows: number) => {
    allTerminals.get(id)?.resize(cols, rows);
  });

  ipcMain.on('pty:kill', (_event, id: number) => {
    const term = allTerminals.get(id);
    if (term) {
      term.kill();
      allTerminals.delete(id);
    }
  });

  ipcMain.handle('pty:getProcess', (_event, id: number) => {
    const term = allTerminals.get(id);
    if (!term) return null;
    if (process.platform === 'linux') {
      try {
        const stat = fs.readFileSync(`/proc/${term.pid}/stat`, 'utf8');
        const closeParenIdx = stat.lastIndexOf(')');
        const fields = stat.slice(closeParenIdx + 2).split(' ');
        const tpgid = parseInt(fields[5], 10);
        if (tpgid > 0) {
          const comm = fs.readFileSync(`/proc/${tpgid}/comm`, 'utf8').trim();
          return comm || term.process;
        }
      } catch {}
    }
    return term.process;
  });

  ipcMain.handle('pty:getCwd', (_event, id: number) => {
    const term = allTerminals.get(id);
    if (!term) return null;
    if (process.platform === 'linux') {
      try {
        return fs.readlinkSync(`/proc/${term.pid}/cwd`);
      } catch {}
    }
    return null;
  });

  ipcMain.handle('pty:isAwaitingInput', (_event, id: number) => {
    const term = allTerminals.get(id);
    if (!term || process.platform !== 'linux') return false;
    try {
      const stat = fs.readFileSync(`/proc/${term.pid}/stat`, 'utf8');
      const closeParenIdx = stat.lastIndexOf(')');
      const fields = stat.slice(closeParenIdx + 2).split(' ');
      const tpgid = parseInt(fields[5], 10);
      if (tpgid <= 0) return false;
      const wchan = fs.readFileSync(`/proc/${tpgid}/wchan`, 'utf8').trim();
      return wchan === 'n_tty_read' || wchan === 'read_chan' || wchan === 'wait_woken';
    } catch {
      return false;
    }
  });

  ipcMain.handle('pty:tabComplete', async (_event, text: string, cwd: string) => {
    const lastWord = text.split(/\s+/).pop() || '';
    const isFirstWord = !text.includes(' ');
    const flags = isFirstWord ? '-c -f' : '-f -d';
    const escaped = lastWord ? lastWord.replace(/'/g, "'\\''") : '';
    const cmd = escaped
      ? `shopt -s nocaseglob nocasematch; compgen ${flags} -- '${escaped}' 2>/dev/null | head -50`
      : `compgen ${flags} 2>/dev/null | head -50`;
    return new Promise<string[]>((resolve) => {
      execFile('bash', ['-c', cmd], { cwd, timeout: 2000 }, (err, stdout) => {
        if (err || !stdout.trim()) { resolve([]); return; }
        const raw = [...new Set(stdout.trim().split('\n').filter(Boolean))];
        const results = raw.map(entry => {
          const absPath = path.isAbsolute(entry) ? entry : path.resolve(cwd, entry);
          try {
            if (fs.statSync(absPath).isDirectory()) return entry + '/';
          } catch {}
          return entry;
        });
        resolve(results);
      });
    });
  });

  ipcMain.handle('pty:getShellHistory', async (_event, count: number) => {
    const home = process.env.HOME || '/';
    const candidates = [
      path.join(home, '.zsh_history'),
      path.join(home, '.bash_history'),
    ];
    for (const histFile of candidates) {
      try {
        const content = fs.readFileSync(histFile, 'utf8');
        const lines = content.split('\n').filter(Boolean);
        const parsed = lines.map(l => {
          const m = l.match(/^: \d+:\d+;(.*)$/);
          return m ? m[1] : l;
        });
        return parsed.slice(-count);
      } catch { continue; }
    }
    return [];
  });
}

export function destroyAllTerminals() {
  for (const term of allTerminals.values()) term.kill();
  allTerminals.clear();
}
