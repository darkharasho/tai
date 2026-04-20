import { ipcMain, BrowserWindow } from 'electron';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { RemoteSshManager } from './remoteSsh';
import { RemoteToolProxy } from './remoteToolProxy';
import { RemoteDaemonProxy } from './remoteDaemonProxy';

const sshManager = new RemoteSshManager();
const toolProxy = new RemoteToolProxy(sshManager);

interface ClaudeState {
  process: ChildProcess | null;
  sessionId: string | null;
  buffer: string;
  busy: boolean;
  permMode: string | null;
  remoteTarget: string | null;
  remoteExecMode: 'auto' | 'local';
  pendingToolUses: Map<string, { id: string; name: string; input: Record<string, any> }>;
  daemonProxy: RemoteDaemonProxy | null;
  daemonEnabled: boolean;
}

const claudeStates = new Map<string, ClaudeState>();

function getState(key: string): ClaudeState {
  let state = claudeStates.get(key);
  if (!state) {
    state = { process: null, sessionId: null, buffer: '', busy: false, permMode: null, remoteTarget: null, remoteExecMode: 'auto', pendingToolUses: new Map(), daemonProxy: null, daemonEnabled: false };
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

function ensureProcess(win: BrowserWindow | null, key: string, cwd: string, permMode: string, model: string, effort: string): ChildProcess {
  const state = getState(key);

  if (state.process && !state.process.killed) {
    if (state.permMode === permMode) {
      return state.process;
    }
    state.process.kill();
    state.process = null;
    state.sessionId = null;
    state.pendingToolUses.clear();
  }
  state.permMode = permMode;

  const args = [
    '-p',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
  ];

  const isRemoteExec = state.remoteTarget && state.remoteExecMode === 'auto';

  if (isRemoteExec) {
    args.push('--permission-mode', 'acceptEdits');
  } else if (permMode === 'bypass') {
    args.push('--permission-mode', 'bypassPermissions');
  } else if (permMode === 'approve-edits') {
    args.push('--permission-mode', 'acceptEdits');
  }

  if (model && model !== 'default') {
    args.push('--model', model);
  }

  if (effort && effort !== 'auto') {
    args.push('--effort', effort);
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

        const isRemoteExec = state.remoteTarget && state.remoteExecMode === 'auto';

        if (isRemoteExec && msg.type === 'assistant' && msg.message?.content) {
          const content = Array.isArray(msg.message.content) ? msg.message.content : [];
          for (const block of content) {
            if (block.type === 'tool_use' && block.id) {
              state.pendingToolUses.set(block.id, { id: block.id, name: block.name, input: block.input });
            }
          }
        }

        if (isRemoteExec && msg.type === 'approval_needed' && msg.toolUseId) {
          const toolInfo = state.pendingToolUses.get(msg.toolUseId);
          if (toolInfo) {
            state.pendingToolUses.delete(msg.toolUseId);
            handleRemoteToolCalls(win, key, state, [toolInfo]);
            continue;
          }
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
    state.pendingToolUses.clear();
  });

  return proc;
}

async function handleRemoteToolCalls(
  win: BrowserWindow | null,
  key: string,
  state: ClaudeState,
  toolUses: Array<{ id: string; name: string; input: Record<string, any> }>,
) {
  // Only connect SSH if daemon is not handling this
  if (!state.daemonEnabled || !state.daemonProxy?.isConnected()) {
    if (!sshManager.isConnected(key) && state.remoteTarget) {
      try {
        await sshManager.connect(key, state.remoteTarget);
      } catch (err: any) {
        for (const tool of toolUses) {
          const errorResult = JSON.stringify({
            type: 'user',
            message: {
              role: 'user',
              content: [{
                type: 'tool_result',
                tool_use_id: tool.id,
                content: `SSH connection failed: ${err.message}. AI commands will run locally.`,
                is_error: true,
              }],
            },
          });
          state.process?.stdin!.write(errorResult + '\n');
        }
        safeSend(win, 'ai:message', key, {
          type: 'remote:connection_failed',
          error: err.message,
        });
        return;
      }
    }
  }

  for (const tool of toolUses) {
    let result: { output: string; isError: boolean };
    if (state.daemonEnabled && state.daemonProxy?.isConnected()) {
      result = await state.daemonProxy.executeTool(tool.name, tool.input);
    } else {
      result = await toolProxy.executeRemoteTool(key, tool.name, tool.input);
    }

    let output = result.output;
    const MAX_OUTPUT = 100 * 1024;
    if (output.length > MAX_OUTPUT) {
      output = output.slice(0, MAX_OUTPUT) + '\n[output truncated at 100KB]';
    }

    const toolResult = JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: tool.id,
          content: output,
          is_error: result.isError,
        }],
      },
    });
    state.process?.stdin!.write(toolResult + '\n');

    safeSend(win, 'ai:message', key, {
      type: 'user',
      message: {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: tool.id,
          content: output,
          is_error: result.isError,
        }],
      },
    });
  }
}

export function setupClaudeService(getWindow: () => BrowserWindow | null) {
  const win = getWindow();

  ipcMain.handle('ai:setDaemonEnabled', async (_event, key: string, enabled: boolean) => {
    const state = getState(key);
    const win = getWindow();

    if (enabled && state.remoteTarget) {
      if (!state.daemonProxy) {
        state.daemonProxy = new RemoteDaemonProxy(state.remoteTarget);
        state.daemonProxy.setOnDisconnect(() => {
          state.daemonEnabled = false;
          safeSend(win, 'ai:message', key, { type: 'remote:daemon_disconnected' });
        });
      }
      try {
        await state.daemonProxy.connect();
        state.daemonEnabled = true;
      } catch (err: any) {
        state.daemonProxy = null;
        state.daemonEnabled = false;
        safeSend(win, 'ai:message', key, { type: 'remote:daemon_connect_failed', error: err.message });
      }
    } else {
      state.daemonProxy?.disconnect();
      state.daemonProxy = null;
      state.daemonEnabled = false;
    }
    return state.daemonEnabled;
  });

  ipcMain.handle('ai:send', (_event, key: string, cwd: string, message: string, permMode: string, model: string, effort?: string) => {
    const win = getWindow();
    const state = getState(key);
    const proc = ensureProcess(win, key, cwd, permMode, model, effort || 'auto');

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

  ipcMain.handle('ai:setRemoteTarget', (_event, key: string, target: string | null, mode: string) => {
    const state = getState(key);
    const wasRemote = state.remoteTarget && state.remoteExecMode === 'auto';
    state.remoteTarget = target;
    state.remoteExecMode = mode as 'auto' | 'local';
    const isRemote = state.remoteTarget && state.remoteExecMode === 'auto';

    if (wasRemote !== isRemote && state.process && !state.process.killed) {
      state.process.kill();
      state.process = null;
      state.sessionId = null;
      state.pendingToolUses.clear();
    }

    if (!target) {
      sshManager.disconnect(key);
    }
    return true;
  });
}

export function destroyAllClaude() {
  for (const state of claudeStates.values()) {
    if (state.process) state.process.kill();
    state.daemonProxy?.disconnect();
  }
  claudeStates.clear();
  sshManager.destroyAll();
}
