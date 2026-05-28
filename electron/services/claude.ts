import { ipcMain, BrowserWindow } from 'electron';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { RemoteSshManager } from './remoteSsh';
import { RemoteToolProxy } from './remoteToolProxy';
import { RemoteDaemonProxy } from './remoteDaemonProxy';
import { generateMcpServerScript, generateMcpConfig } from './mcpRemoteServer';
import { generateHistoryServerScript, generateHistoryMcpConfig } from './mcpHistoryServer';
import { enrichEnv, resolveBinary } from './platform';

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
  historyFilePath: string | null;
}

const claudeStates = new Map<string, ClaudeState>();

function getState(key: string): ClaudeState {
  let state = claudeStates.get(key);
  if (!state) {
    state = { process: null, sessionId: null, buffer: '', busy: false, permMode: null, remoteTarget: null, remoteExecMode: 'auto', pendingToolUses: new Map(), daemonProxy: null, daemonEnabled: false, historyFilePath: null };
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
  return enrichEnv();
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

  if (isRemoteExec || permMode === 'bypass') {
    // Remote exec: user already trusted the remote by enabling the daemon.
    // bypassPermissions also auto-approves the MCP tool calls that route to it.
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

  let mcpServerPath: string | null = null;
  let mcpConfigPath: string | null = null;
  let sshConfigPath: string | null = null;
  let historyServerPath: string | null = null;

  const safeKey = key.replace(/[^a-z0-9]/gi, '_');
  const tmp = os.tmpdir();

  // Terminal history MCP server: exposes a TerminalHistory tool so Claude can
  // retrieve recent commands/output from the current session on demand.
  const historyFilePath = path.join(tmp, `tai-history-${safeKey}.json`);
  state.historyFilePath = historyFilePath;
  // Seed with empty array so the file exists before the server reads it
  if (!fs.existsSync(historyFilePath)) {
    fs.writeFileSync(historyFilePath, '[]', { mode: 0o600 });
  }
  historyServerPath = path.join(tmp, `tai-mcp-history-${safeKey}.cjs`);
  fs.writeFileSync(historyServerPath, generateHistoryServerScript(historyFilePath), { mode: 0o755 });

  // Build merged MCP config with history server (and optionally remote server)
  let mcpServers: Record<string, any> = {
    ...(generateHistoryMcpConfig(historyServerPath) as any).mcpServers,
  };

  if (isRemoteExec && state.daemonEnabled) {
    // SSH config: include ~/.ssh/config (user-owned) but skip system files
    sshConfigPath = path.join(tmp, `tai-ssh-config-${safeKey}`);
    fs.writeFileSync(sshConfigPath, `Include ~/.ssh/config\nBatchMode yes\nStrictHostKeyChecking accept-new\n`, { mode: 0o600 });

    // MCP server: routes all tool calls through the daemon on the remote host
    mcpServerPath = path.join(tmp, `tai-mcp-server-${safeKey}.cjs`);
    fs.writeFileSync(mcpServerPath, generateMcpServerScript(state.remoteTarget!, sshConfigPath), { mode: 0o755 });

    mcpServers = { ...mcpServers, ...(generateMcpConfig(mcpServerPath) as any).mcpServers };
    args.push('--disallowed-tools', 'Bash,Read,Write,Edit,Grep,Glob,WebFetch,WebSearch');
    console.log(`[daemon] remote exec via MCP server: ${mcpServerPath} -> ${state.remoteTarget}`);
  }

  mcpConfigPath = path.join(tmp, `tai-mcp-config-${safeKey}.json`);
  fs.writeFileSync(mcpConfigPath, JSON.stringify({ mcpServers }), { mode: 0o600 });
  args.push('--mcp-config', mcpConfigPath);
  // Auto-approve the read-only history tool so it doesn't trigger approval prompts
  args.push('--allowedTools', 'mcp__tai-history__TerminalHistory');

  const env = enrichedEnv();
  const proc = spawn(resolveBinary('claude', env), args, {
    cwd,
    env,
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
              console.log(`[daemon] queued tool: ${block.name} id=${block.id}`);
              state.pendingToolUses.set(block.id, { id: block.id, name: block.name, input: block.input });
            }
          }
        }

        if (msg.type !== 'system' && msg.type !== 'assistant') {
          console.log(`[daemon] msg type=${msg.type} isRemoteExec=${!!isRemoteExec} toolUseId=${msg.toolUseId}`);
        }

        if (isRemoteExec && msg.type === 'approval_needed' && msg.toolUseId) {
          let toolInfo = state.pendingToolUses.get(msg.toolUseId);
          if (!toolInfo && msg.toolName) {
            // Fallback: reconstruct tool info from approval_needed message fields
            const input: Record<string, any> = {};
            if (msg.command !== undefined) input.command = msg.command;
            toolInfo = { id: msg.toolUseId, name: msg.toolName, input };
          }
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
    const text = chunk.toString();
    if (isRemoteExec) console.log(`[daemon] claude/bwrap stderr: ${text.trim()}`);
    safeSend(win, 'ai:error', key, text);
  });

  proc.on('exit', (code, signal) => {
    console.log(`[daemon] claude process exited code=${code} signal=${signal}`);
    const wasBusy = state.busy;
    state.process = null;
    state.busy = false;
    state.pendingToolUses.clear();
    for (const p of [mcpServerPath, mcpConfigPath, sshConfigPath, historyServerPath, historyFilePath]) {
      if (p) try { fs.unlinkSync(p); } catch {}
    }
    if (wasBusy) {
      safeSend(win, 'ai:message', key, { type: 'done' });
    }
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
    console.log(`[daemon] setDaemonEnabled key=${key} enabled=${enabled} remoteTarget=${state.remoteTarget}`);

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
        console.log(`[daemon] connected successfully to ${state.remoteTarget}`);
        let systemInfo = '';
        try {
          const infoResult = await state.daemonProxy.executeTool('Bash', {
            command: "uname -srm; cat /etc/os-release 2>/dev/null | grep PRETTY_NAME | cut -d= -f2 | tr -d '\"'",
          });
          if (!infoResult.isError) systemInfo = infoResult.output.trim();
        } catch {}
        console.log(`[daemon] remote system info: ${systemInfo}`);
        safeSend(win, 'ai:message', key, { type: 'remote:daemon_connected', systemInfo });
      } catch (err: any) {
        state.daemonProxy = null;
        state.daemonEnabled = false;
        console.log(`[daemon] connect failed: ${err.message}`);
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

  // Receive terminal history snapshots from the renderer and persist to the
  // temp file that the MCP history server reads from.
  ipcMain.on('ai:updateHistory', (_event, key: string, entries: Array<{ command: string; output: string; exitCode?: number }>) => {
    const state = getState(key);
    if (state.historyFilePath) {
      try {
        fs.writeFileSync(state.historyFilePath, JSON.stringify(entries), { mode: 0o600 });
      } catch {}
    }
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
    console.log(`[daemon] setRemoteTarget key=${key} target=${target} mode=${mode}`);
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
