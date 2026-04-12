import { ipcMain, BrowserWindow } from 'electron';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

interface ClaudeState {
  process: ChildProcess | null;
  sessionId: string | null;
  buffer: string;
  busy: boolean;
}

const claudeStates = new Map<string, ClaudeState>();

function getState(key: string): ClaudeState {
  let state = claudeStates.get(key);
  if (!state) {
    state = { process: null, sessionId: null, buffer: '', busy: false };
    claudeStates.set(key, state);
  }
  return state;
}

function safeSend(win: BrowserWindow | null, channel: string, ...args: unknown[]) {
  try {
    if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
  } catch {}
}

function enrichedEnv(): Record<string, string> {
  const env = { ...process.env } as Record<string, string>;
  const home = env.HOME || '/';
  const extraPaths = [
    path.join(home, '.local/bin'),
    path.join(home, '.nvm/current/bin'),
    path.join(home, '.volta/bin'),
    '/usr/local/bin',
    '/opt/homebrew/bin',
  ];
  env.PATH = [...extraPaths, env.PATH || ''].join(':');
  return env;
}

function ensureProcess(win: BrowserWindow | null, key: string, cwd: string, permMode: string, model: string): ChildProcess {
  const state = getState(key);

  if (state.process && !state.process.killed) {
    return state.process;
  }

  const args = [
    '-p',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
  ];

  if (permMode === 'bypass') {
    args.push('--permission-mode', 'bypassPermissions');
  } else if (permMode === 'approve-edits') {
    args.push('--permission-mode', 'acceptEdits');
  } else {
    args.push('--permission-mode', 'acceptEdits');
  }

  if (model) {
    args.push('--model', model);
  }

  if (state.sessionId) {
    args.push('--resume', state.sessionId);
  }

  const proc = spawn('claude', args, {
    cwd,
    env: enrichedEnv(),
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  state.process = proc;
  state.buffer = '';

  proc.stdout!.on('data', (chunk: Buffer) => {
    state.buffer += chunk.toString();
    const lines = state.buffer.split('\n');
    state.buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);

        if (msg.type === 'system' && msg.session_id) {
          state.sessionId = msg.session_id;
        }

        if (msg.type === 'result') {
          state.busy = false;
          safeSend(win, 'ai:message', key, { type: 'done', content: msg });
          continue;
        }

        safeSend(win, 'ai:message', key, msg);
      } catch {}
    }
  });

  proc.stderr!.on('data', (chunk: Buffer) => {
    safeSend(win, 'ai:error', key, chunk.toString());
  });

  proc.on('exit', () => {
    state.process = null;
    state.busy = false;
  });

  return proc;
}

export function setupClaudeService(getWindow: () => BrowserWindow | null) {
  ipcMain.handle('ai:send', (_event, key: string, cwd: string, message: string, permMode: string, model: string) => {
    const win = getWindow();
    const state = getState(key);
    const proc = ensureProcess(win, key, cwd, permMode, model);

    state.busy = true;
    const payload = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: message },
    });
    proc.stdin!.write(payload + '\n');

    return true;
  });

  ipcMain.on('ai:cancel', (_event, key: string) => {
    const state = getState(key);
    if (state.process && !state.process.killed) {
      state.process.kill('SIGINT');
    }
    state.busy = false;
  });

  ipcMain.on('ai:stop', (_event, key: string) => {
    const state = getState(key);
    if (state.process) {
      state.process.kill();
      state.process = null;
    }
    state.busy = false;
  });

  ipcMain.handle('ai:approve', (_event, key: string, toolUseId: string, approved: boolean) => {
    const state = getState(key);
    if (!state.process || state.process.killed) return false;

    if (!approved) {
      const deny = JSON.stringify({
        type: 'user',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: toolUseId, content: 'User denied this action.' }],
        },
      });
      state.process.stdin!.write(deny + '\n');
    }
    return true;
  });
}

export function destroyAllClaude() {
  for (const state of claudeStates.values()) {
    if (state.process) state.process.kill();
  }
  claudeStates.clear();
}
