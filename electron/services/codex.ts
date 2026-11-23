import { spawn, ChildProcess } from 'node:child_process';
import { ipcMain, BrowserWindow } from 'electron';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { enrichEnv, resolveBinary } from './platform';
import { createIdleWatchdog } from './idleWatchdog';
import { askpassEnvFor, cancelAskpassForKey } from './askpassService';
import { getCodexModels } from './codexModels';

function enrichedEnv(): Record<string, string> {
  return enrichEnv();
}

function safeSend(win: BrowserWindow | null, channel: string, ...args: unknown[]) {
  try {
    if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
  } catch { /* window destroyed */ }
}

/** Codex wraps every command as `/bin/bash -lc '<cmd>'`; show the user's command. */
export function unwrapShellCommand(command: string): string {
  const m = /^\S*\/(?:ba|z)?sh -lc '([\s\S]*)'$/.exec(command);
  return m ? m[1].replace(/'\\''/g, "'") : command;
}

/** Codex nests the API error as a JSON string; surface its human message. */
function codexErrorText(raw: unknown): string {
  const text = typeof raw === 'string' ? raw
    : raw && typeof raw === 'object' && typeof (raw as any).message === 'string' ? (raw as any).message
    : '';
  if (!text) return 'Codex error';
  try {
    const parsed = JSON.parse(text);
    const inner = parsed?.error?.message ?? parsed?.message;
    if (typeof inner === 'string' && inner) return inner;
  } catch { /* not JSON */ }
  return text;
}

function fileChangePaths(item: any): string {
  if (Array.isArray(item?.changes)) {
    return item.changes.map((c: any) => c?.path).filter(Boolean).join(', ');
  }
  return item?.file_path || item?.path || '';
}

/** Argument list for one `codex exec` turn (new thread, or resume of `sessionId`). */
export function buildCodexArgs(opts: { sessionId: string | null; model: string; permMode: string; message: string; effort?: string }): string[] {
  const args: string[] = ['exec'];
  if (opts.sessionId) args.push('resume');
  args.push('--json', '--skip-git-repo-check');
  if (opts.model) args.push('-m', opts.model);
  if (opts.effort && /^[a-z]+$/.test(opts.effort)) args.push('-c', `model_reasoning_effort="${opts.effort}"`);
  // `exec resume` has no --sandbox flag (and --full-auto is gone), so the
  // sandbox goes through a config override, which both subcommands accept.
  if (opts.permMode === 'full-access') {
    args.push('--dangerously-bypass-approvals-and-sandbox');
  } else {
    const mode = opts.permMode === 'read-only' ? 'read-only' : 'workspace-write';
    args.push('-c', `sandbox_mode="${mode}"`);
  }
  // `--` so a prompt starting with "-" isn't parsed as a flag.
  args.push('--');
  if (opts.sessionId) args.push(opts.sessionId);
  args.push(opts.message);
  return args;
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
              input: { command: unwrapShellCommand(item.command || '') },
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
              input: { file_path: fileChangePaths(item) },
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
      } else if (item?.type === 'file_change' && item?.id) {
        const failed = item.status === 'failed';
        events.push({
          type: 'user',
          projectPath,
          message: {
            content: [{
              type: 'tool_result',
              tool_use_id: item.id,
              content: failed ? 'File change failed' : fileChangePaths(item),
              is_error: failed,
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
      events.push({ type: 'error', projectPath, text: codexErrorText(msg.error ?? msg.message) });
      events.push({ type: 'done', projectPath });
      break;

    // A stream error. It may be retried, and a fatal one is followed by
    // turn.failed (or process exit), which settles the turn.
    case 'error':
      events.push({ type: 'error', projectPath, text: codexErrorText(msg.message ?? msg.error) });
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
  // codex:models — the account's model catalog, from the CLI itself.
  ipcMain.handle('codex:models', () => {
    const env = enrichedEnv();
    return getCodexModels(resolveBinary('codex', env), env);
  });

  ipcMain.handle('codex:send', (_event, key: string, cwd: string, message: string, permMode: string, model: string, effort?: string) => {
    const win = getWindow();
    const state = getState(key);

    if (state.process) {
      state.process.kill();
      state.process = null;
    }

    const args = buildCodexArgs({ sessionId: state.sessionId, model, permMode, message, effort });
    let lastErrorText: string | null = null;

    const env = { ...enrichedEnv(), ...askpassEnvFor(key) };
    const proc = spawn(resolveBinary('codex', env), args, {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    proc.stdin?.end();

    state.process = proc;
    state.busy = true;
    state.buffer = '';

    const watchdog = createIdleWatchdog({
      onIdle: () => {
        if (state.process && !state.process.killed) state.process.kill();
        if (state.busy) {
          state.busy = false;
          safeSend(win, 'ai:error', key, 'AI provider timed out (no output for 120s).');
          safeSend(win, 'ai:message', key, { type: 'done' });
        }
      },
    });

    safeSend(win, 'ai:message', key, { type: 'streaming_start' });

    proc.stdout?.on('data', (data: Buffer) => {
      watchdog.kick();
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
            // A fatal error arrives as `error` then `turn.failed` with the same text.
            if (ev.type === 'error') {
              if (ev.text === lastErrorText) continue;
              lastErrorText = ev.text;
            }
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
      watchdog.cancel();
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
    cancelAskpassForKey(key);
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
