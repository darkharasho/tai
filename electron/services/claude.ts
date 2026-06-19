import { ipcMain, BrowserWindow } from 'electron';
import { spawn, execFile, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { RemoteSshManager } from './remoteSsh';
import { RemoteToolProxy } from './remoteToolProxy';
import { RemoteDaemonProxy } from './remoteDaemonProxy';
import { generateMcpServerScript, generateMcpConfig } from './mcpRemoteServer';
import { generateHistoryServerScript, generateHistoryMcpConfig } from './mcpHistoryServer';
import { enrichEnv, resolveBinary } from './platform';
import { getAvailableClaudeModels } from './claudeModels';
import { createIdleWatchdog } from './idleWatchdog';
import { safeWrite } from './procIo';

const sshManager = new RemoteSshManager();
const toolProxy = new RemoteToolProxy(sshManager);

interface PendingToolUse {
  toolName: string;
  toolUseId: string;
  input: Record<string, any>;
}

interface ClaudeState {
  process: ChildProcess | null;
  sessionId: string | null;
  buffer: string;
  busy: boolean;
  permMode: string | null;
  cwd: string | null;
  remoteTarget: string | null;
  remoteExecMode: 'auto' | 'local';
  pendingToolUses: Map<string, { id: string; name: string; input: Record<string, any> }>;
  /** Approval flow: the most recent tool_use from the assistant. */
  pendingToolUse: PendingToolUse | null;
  /** True while the approval popup is shown and messages are being buffered. */
  awaitingApproval: boolean;
  /** Messages buffered while the approval popup is visible. */
  approvalBuffered: any[];
  daemonProxy: RemoteDaemonProxy | null;
  daemonEnabled: boolean;
  historyFilePath: string | null;
}

const claudeStates = new Map<string, ClaudeState>();

function getState(key: string): ClaudeState {
  let state = claudeStates.get(key);
  if (!state) {
    state = { process: null, sessionId: null, buffer: '', busy: false, permMode: null, cwd: null, remoteTarget: null, remoteExecMode: 'auto', pendingToolUses: new Map(), pendingToolUse: null, awaitingApproval: false, approvalBuffered: [], daemonProxy: null, daemonEnabled: false, historyFilePath: null };
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

/** Extract a human-readable command string from tool input. */
function toolCommandString(input: Record<string, any>): string {
  return input.command
    || input.file_path
    || input.path
    || input.pattern
    || input.url
    || input.query
    || Object.values(input).find(v => typeof v === 'string' && v.length > 0)
    || JSON.stringify(input);
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
    state.pendingToolUse = null;
    state.awaitingApproval = false;
    state.approvalBuffered = [];
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
    args.push('--permission-mode', 'bypassPermissions');
  } else {
    // The CLI's stream-json mode has no interactive approval protocol — it
    // auto-denies tools that aren't permitted.  TAI detects these denials,
    // shows an approval popup, and executes approved tools locally.
    // acceptEdits auto-approves file reads/writes/edits (safe); Bash is denied
    // and routed through our approval flow.  For 'ask' mode we want to gate
    // every tool, so we use 'plan' which denies everything.
    args.push('--permission-mode', permMode === 'ask' ? 'plan' : 'acceptEdits');
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

  proc.stdout!.on('data', (chunk: Buffer) => {
    watchdog.kick();
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

        // ── Approval flow: buffer messages while awaiting user decision ──
        if (state.awaitingApproval) {
          if (msg.type === 'result') {
            // Turn ended while we're still awaiting approval — buffer it so
            // we can replay it if the user denies.
            state.approvalBuffered.push(msg);
          } else {
            state.approvalBuffered.push(msg);
          }
          continue;
        }

        // Track the most recent tool_use from assistant messages so we can
        // pair it with a subsequent denial tool_result.
        if (msg.type === 'assistant' && msg.message?.content) {
          const content = Array.isArray(msg.message.content) ? msg.message.content : [];
          for (const block of content) {
            if (block.type === 'tool_use') {
              state.pendingToolUse = {
                toolName: block.name,
                toolUseId: block.id,
                input: block.input || {},
              };
            }
          }
        }

        // Detect tool_result denial → trigger approval popup
        if (msg.type === 'user' && msg.message?.content && state.pendingToolUse) {
          const content = Array.isArray(msg.message.content) ? msg.message.content : [];
          const denialBlock = content.find((block: any) => {
            if (block.type !== 'tool_result' || !block.is_error || typeof block.content !== 'string') return false;
            const lower = block.content.toLowerCase();
            return lower.includes('requested permissions') ||
                   lower.includes('was blocked') ||
                   lower.includes("haven't granted");
          });
          if (denialBlock) {
            state.awaitingApproval = true;
            state.approvalBuffered = [];
            const tu = state.pendingToolUse;
            safeSend(win, 'ai:message', key, {
              type: 'approval_needed',
              toolUseId: tu.toolUseId,
              toolName: tu.toolName,
              command: toolCommandString(tu.input),
              input: tu.input,
            });
            continue; // don't forward the denial to the renderer
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
    watchdog.cancel();
    console.log(`[daemon] claude process exited code=${code} signal=${signal}`);
    const wasBusy = state.busy;
    state.process = null;
    state.busy = false;
    state.pendingToolUses.clear();
    state.pendingToolUse = null;
    state.awaitingApproval = false;
    state.approvalBuffered = [];
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
          safeWrite(state.process, errorResult + '\n', (err) => {
            state.busy = false;
            safeSend(win, 'ai:error', key, `Failed to send to AI provider: ${err.message}`);
            safeSend(win, 'ai:message', key, { type: 'done' });
          });
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
    safeWrite(state.process, toolResult + '\n', (err) => {
      state.busy = false;
      safeSend(win, 'ai:error', key, `Failed to send to AI provider: ${err.message}`);
      safeSend(win, 'ai:message', key, { type: 'done' });
    });

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

  // ai:models — which Claude models this account/org can actually use (org
  // allow-lists and 1M gating vary), derived from the CLI cache in ~/.claude.json
  // rather than hardcoded. Falls back to the built-in set when not logged in.
  ipcMain.handle('ai:models', () => getAvailableClaudeModels());

  ipcMain.handle('ai:send', (_event, key: string, cwd: string, message: string, permMode: string, model: string, effort?: string) => {
    const win = getWindow();
    const state = getState(key);
    state.cwd = cwd;
    const proc = ensureProcess(win, key, cwd, permMode, model, effort || 'auto');

    state.busy = true;
    const payload = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: message },
    });
    safeWrite(proc, payload + '\n', (err) => {
      state.busy = false;
      safeSend(win, 'ai:error', key, `Failed to send to AI provider: ${err.message}`);
      safeSend(win, 'ai:message', key, { type: 'done' });
    });

    return true;
  });

  ipcMain.on('ai:cancel', (_event, key: string) => {
    const state = getState(key);
    state.awaitingApproval = false;
    state.approvalBuffered = [];
    state.pendingToolUse = null;
    if (state.process && !state.process.killed) {
      state.process.kill('SIGINT');
    }
    state.busy = false;
  });

  ipcMain.on('ai:stop', (_event, key: string) => {
    const state = getState(key);
    state.awaitingApproval = false;
    state.approvalBuffered = [];
    state.pendingToolUse = null;
    if (state.process) {
      state.process.kill();
      state.process = null;
    }
    state.busy = false;
  });

  // Receive terminal history snapshots from the renderer and persist to the
  // temp file that the MCP history server reads from.
  ipcMain.on('ai:updateHistory', (_event, key: string, entries: Array<{ command: string; output: string; exitCode?: number; cwd?: string; gitBranch?: string | null; durationMs?: number; timestamp?: number }>) => {
    const state = getState(key);
    if (state.historyFilePath) {
      try {
        fs.writeFileSync(state.historyFilePath, JSON.stringify(entries), { mode: 0o600 });
      } catch {}
    }
  });

  // Approval handler.  The CLI already denied the tool (using its internal
  // permission mode).  On approve we execute the tool locally in Electron and
  // send the result to the CLI as a new user message so the conversation
  // continues.  On deny we flush the buffered messages (the model already
  // responded to the denial).
  ipcMain.handle('ai:approve', async (_event, key: string, toolUseId: string, approved: boolean) => {
    const win = getWindow();
    const state = getState(key);
    if (!state.pendingToolUse || !state.awaitingApproval) return false;

    const pending = state.pendingToolUse;
    const cwd = state.cwd || process.cwd();

    // --- Deny path: flush buffered messages ---
    if (!approved) {
      for (const buffered of state.approvalBuffered) {
        if (buffered.type === 'result') {
          state.busy = false;
          safeSend(win, 'ai:message', key, { type: 'done', content: buffered });
        } else {
          safeSend(win, 'ai:message', key, buffered);
        }
      }
      state.approvalBuffered = [];
      state.awaitingApproval = false;
      state.pendingToolUse = null;
      return true;
    }

    // --- Approve path: execute the tool locally ---
    let result = '';
    let isError = false;

    try {
      if (pending.toolName === 'Bash') {
        const command = pending.input.command || '';
        const execResult = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
          execFile('bash', ['-c', command], {
            cwd,
            timeout: 120_000,
            maxBuffer: 10 * 1024 * 1024,
            env: { ...process.env, ...enrichedEnv() },
          }, (err, stdout, stderr) => {
            if (err && !stdout && !stderr) reject(err);
            else resolve({ stdout: stdout || '', stderr: stderr || '' });
          });
        });
        result = execResult.stdout;
        if (execResult.stderr) result += (result ? '\n' : '') + execResult.stderr;
      } else if (pending.toolName === 'Write') {
        const filePath = pending.input.file_path;
        const content = pending.input.content || '';
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(filePath, content, 'utf-8');
        result = `Successfully wrote to ${filePath}`;
      } else if (pending.toolName === 'Edit') {
        const filePath = pending.input.file_path;
        const oldStr = pending.input.old_string;
        const newStr = pending.input.new_string;
        if (!fs.existsSync(filePath)) {
          result = `File not found: ${filePath}`;
          isError = true;
        } else {
          let fileContent = fs.readFileSync(filePath, 'utf-8');
          if (!fileContent.includes(oldStr)) {
            result = `old_string not found in ${filePath}`;
            isError = true;
          } else {
            fileContent = fileContent.replace(oldStr, newStr);
            fs.writeFileSync(filePath, fileContent, 'utf-8');
            result = `Successfully edited ${filePath}`;
          }
        }
      } else if (pending.toolName === 'Read') {
        const filePath = pending.input.file_path;
        if (!fs.existsSync(filePath)) {
          result = `File not found: ${filePath}`;
          isError = true;
        } else {
          result = fs.readFileSync(filePath, 'utf-8');
        }
      } else {
        // Unknown tool — add to settings.local.json allow list and ask CLI to retry.
        const claudeDir = path.join(cwd, '.claude');
        const settingsPath = path.join(claudeDir, 'settings.local.json');
        let settings: Record<string, any> = {};
        if (fs.existsSync(settingsPath)) {
          try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')); } catch {}
        }
        if (!settings.permissions) settings.permissions = {};
        if (!Array.isArray(settings.permissions.allow)) settings.permissions.allow = [];
        if (!settings.permissions.allow.includes(pending.toolName)) {
          settings.permissions.allow.push(pending.toolName);
          try { fs.mkdirSync(claudeDir, { recursive: true }); } catch {}
          fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
        }

        // Flush buffered messages then tell the CLI to retry
        for (const buffered of state.approvalBuffered) {
          if (buffered.type === 'result') {
            state.busy = false;
            safeSend(win, 'ai:message', key, { type: 'done', content: buffered });
          } else {
            safeSend(win, 'ai:message', key, buffered);
          }
        }
        state.approvalBuffered = [];
        state.awaitingApproval = false;
        state.pendingToolUse = null;

        state.busy = true;
        const retryMsg = JSON.stringify({
          type: 'user',
          message: {
            role: 'user',
            content: `The user has approved the use of the "${pending.toolName}" tool. Please proceed with the same tool call you just attempted.`,
          },
        });
        safeWrite(state.process, retryMsg + '\n', (err) => {
          state.busy = false;
          safeSend(win, 'ai:error', key, `Failed to send to AI provider: ${err.message}`);
          safeSend(win, 'ai:message', key, { type: 'done' });
        });
        return true;
      }
    } catch (err: any) {
      result = err.message || 'Command execution failed';
      isError = true;
    }

    // Send the real tool result to the renderer
    safeSend(win, 'ai:message', key, {
      type: 'user',
      message: {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: pending.toolUseId,
          content: result,
          is_error: isError,
        }],
      },
    });

    state.approvalBuffered = [];
    state.awaitingApproval = false;
    state.pendingToolUse = null;

    // Send the tool output to the CLI as a new user message so the model
    // can continue with the actual result.
    const maxLen = 8000;
    const truncated = result.length > maxLen
      ? result.slice(0, maxLen) + `\n... (truncated ${result.length - maxLen} chars)`
      : result;
    const followUp = JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: `[${pending.toolName} output]\n${truncated}`,
      },
    });
    safeWrite(state.process, followUp + '\n', (err) => {
      state.busy = false;
      safeSend(win, 'ai:error', key, `Failed to send to AI provider: ${err.message}`);
      safeSend(win, 'ai:message', key, { type: 'done' });
    });

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
      state.pendingToolUse = null;
      state.awaitingApproval = false;
      state.approvalBuffered = [];
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
