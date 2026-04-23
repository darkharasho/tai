import { spawn, ChildProcess } from 'node:child_process';
import { ipcMain, BrowserWindow } from 'electron';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { enrichEnv, resolveBinary } from './platform';

function enrichedEnv(): Record<string, string> {
  return enrichEnv();
}

function safeSend(win: BrowserWindow | null, channel: string, ...args: unknown[]) {
  try {
    if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
  } catch { /* window destroyed */ }
}

export function translateCodexEvent(msg: any, projectPath: string): any[] {
  const events: any[] = [];

  switch (msg.type) {
    case 'thread.started':
      if (msg.thread_id) {
        events.push({ type: 'session_id', sessionId: msg.thread_id, projectPath });
      }
      break;

    case 'turn.started':
      break;

    case 'item.started': {
      const item = msg.item;
      if (item?.type === 'command_execution') {
        events.push({
          type: 'assistant',
          projectPath,
          message: {
            content: [{
              id: item.id,
              type: 'tool_use',
              name: 'Bash',
              input: { command: item.command || '' },
            }],
          },
        });
      } else if (item?.type === 'file_change') {
        events.push({
          type: 'assistant',
          projectPath,
          message: {
            content: [{
              id: item.id,
              type: 'tool_use',
              name: 'Edit',
              input: { file_path: item.file_path || item.path || '' },
            }],
          },
        });
      }
      break;
    }

    case 'item.completed': {
      const item = msg.item;
      if (item?.type === 'agent_message' && item?.text) {
        events.push({
          type: 'assistant',
          projectPath,
          message: {
            content: [{ type: 'text', text: item.text }],
          },
        });
      } else if (item?.type === 'command_execution' && item?.id) {
        events.push({
          type: 'user',
          projectPath,
          message: {
            content: [{
              type: 'tool_result',
              tool_use_id: item.id,
              content: item.aggregated_output || '',
              is_error: (item.exit_code || 0) !== 0,
            }],
          },
        });
      } else if (item?.type === 'reasoning' && item?.text) {
        events.push({
          type: 'assistant',
          projectPath,
          message: {
            content: [{ type: 'text', text: item.text }],
          },
        });
      }
      break;
    }

    case 'turn.completed': {
      const usage = msg.usage;
      events.push({
        type: 'result',
        projectPath,
        ...(usage ? {
          usage: {
            input_tokens: usage.input_tokens || 0,
            cache_read_input_tokens: usage.cached_input_tokens || 0,
            cache_creation_input_tokens: 0,
            output_tokens: usage.output_tokens || 0,
          },
        } : {}),
      });
      events.push({ type: 'done', projectPath });
      break;
    }

    case 'turn.failed':
    case 'error':
      events.push({
        type: 'error',
        projectPath,
        text: msg.message || msg.error || 'Codex error',
      });
      events.push({ type: 'done', projectPath });
      break;

    default:
      break;
  }

  return events;
}

interface CodexState {
  process: ChildProcess | null;
  sessionId: string | null;
  buffer: string;
  busy: boolean;
}

const codexStates = new Map<string, CodexState>();

function getState(key: string): CodexState {
  let state = codexStates.get(key);
  if (!state) {
    state = { process: null, sessionId: null, buffer: '', busy: false };
    codexStates.set(key, state);
  }
  return state;
}

export function setupCodexService(getWindow: () => BrowserWindow | null) {
  ipcMain.handle('codex:send', (_event, key: string, cwd: string, message: string, permMode: string, model: string) => {
    const win = getWindow();
    const state = getState(key);

    if (state.process) {
      state.process.kill();
      state.process = null;
    }

    const args: string[] = [];
    if (state.sessionId) {
      args.push('exec', 'resume', '--json', '--skip-git-repo-check', state.sessionId);
    } else {
      args.push('exec', '--json', '--skip-git-repo-check');
    }

    if (model) {
      args.push('-m', model);
    }

    if (permMode === 'full-access') {
      args.push('--dangerously-bypass-approvals-and-sandbox');
    } else if (permMode === 'read-only') {
      args.push('--sandbox', 'read-only');
    } else {
      args.push('--full-auto');
    }

    args.push(message);

    const env = enrichedEnv();
    const proc = spawn(resolveBinary('codex', env), args, {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    proc.stdin?.end();

    state.process = proc;
    state.busy = true;
    state.buffer = '';

    safeSend(win, 'ai:message', key, { type: 'streaming_start' });

    proc.stdout?.on('data', (data: Buffer) => {
      if (state.process !== proc) return;

      state.buffer += data.toString();
      const lines = state.buffer.split('\n');
      state.buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.type === 'thread.started' && msg.thread_id && !state.sessionId) {
            state.sessionId = msg.thread_id;
          }
          const events = translateCodexEvent(msg, cwd);
          for (const ev of events) {
            safeSend(win, 'ai:message', key, ev);
          }
          if (msg.type === 'turn.completed' || msg.type === 'turn.failed') {
            state.busy = false;
          }
        } catch { /* malformed JSON */ }
      }
    });

    proc.stderr?.on('data', (data: Buffer) => {
      if (state.process !== proc) return;
      const text = data.toString().trim();
      if (!text) return;
      if (/^Reading .* from stdin/i.test(text)) return;
      safeSend(win, 'ai:message', key, { type: 'error', text });
    });

    proc.on('exit', () => {
      if (state.process !== proc) return;
      if (state.buffer.trim()) {
        try {
          const msg = JSON.parse(state.buffer);
          const events = translateCodexEvent(msg, cwd);
          for (const ev of events) {
            safeSend(win, 'ai:message', key, ev);
          }
        } catch { /* ignore */ }
      }
      const wasBusy = state.busy;
      state.buffer = '';
      state.process = null;
      state.busy = false;
      if (wasBusy) {
        safeSend(win, 'ai:message', key, { type: 'done' });
      }
    });

    proc.on('error', (err) => {
      if (state.process !== proc) return;
      state.process = null;
      state.busy = false;
      safeSend(win, 'ai:message', key, { type: 'error', text: `Codex process error: ${err.message}` });
      safeSend(win, 'ai:message', key, { type: 'done' });
    });

    return true;
  });

  ipcMain.on('codex:stop', (_event, key: string) => {
    const state = getState(key);
    if (state.process) {
      const proc = state.process;
      state.process = null;
      state.busy = false;
      proc.kill();
      safeSend(getWindow(), 'ai:message', key, { type: 'done' });
    }
  });

  ipcMain.on('codex:setSessionId', (_event, key: string, sessionId: string | undefined) => {
    const state = getState(key);
    if (state.process) {
      state.process.kill();
      state.process = null;
      state.busy = false;
    }
    state.sessionId = sessionId || null;
  });
}

export function destroyAllCodex() {
  for (const state of codexStates.values()) {
    if (state.process) state.process.kill();
  }
  codexStates.clear();
}
