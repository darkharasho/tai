import { ipcMain, BrowserWindow } from 'electron';
import { ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { query } from '@anthropic-ai/claude-agent-sdk';
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { sdkOptions, HISTORY_TOOL } from './claudeSdkOptions';
import { translateSdkMessage } from './claudeSdkTranslate';
import { ApprovalBridge } from './claudeApprovalBridge';
import { RemoteSshManager } from './remoteSsh';
import { RemoteToolProxy } from './remoteToolProxy';
import { RemoteDaemonProxy } from './remoteDaemonProxy';
import { generateMcpServerScript, generateMcpConfig } from './mcpRemoteServer';
import { generateHistoryServerScript, generateHistoryMcpConfig } from './mcpHistoryServer';
import { enrichEnv } from './platform';
import { getAvailableClaudeModels } from './claudeModels';
import { createIdleWatchdog } from './idleWatchdog';
import { classifyProviderError } from '../../src/utils/classifyProviderError';

const sshManager = new RemoteSshManager();
const toolProxy = new RemoteToolProxy(sshManager);

interface ClaudeState {
  /** Pushes the next queued user turn into the live query; null when idle. */
  pushInput: ((m: SDKUserMessage) => void) | null;
  /** Ends the input stream, letting the query finish. */
  endInput: (() => void) | null;
  sessionId: string | null;
  busy: boolean;
  permMode: string | null;
  cwd: string | null;
  remoteTarget: string | null;
  remoteExecMode: 'auto' | 'local';
  approvals: ApprovalBridge;
  abort: AbortController | null;
  daemonProxy: RemoteDaemonProxy | null;
  daemonEnabled: boolean;
  historyFilePath: string | null;
}

const claudeStates = new Map<string, ClaudeState>();

function getState(key: string): ClaudeState {
  let state = claudeStates.get(key);
  if (!state) {
    state = {
      pushInput: null, endInput: null, sessionId: null, busy: false,
      permMode: null, cwd: null, remoteTarget: null, remoteExecMode: 'auto',
      approvals: new ApprovalBridge(), abort: null,
      daemonProxy: null, daemonEnabled: false, historyFilePath: null,
    };
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

// Build an MCP server map for the SDK from the temp .cjs server scripts.
// (Same scripts the CLI path used; only the wiring changes.)
function buildMcpServers(state: ClaudeState, key: string): Record<string, any> {
  const tmp = os.tmpdir();
  const safeKey = key.replace(/[^a-z0-9]/gi, '_');
  const historyFilePath = path.join(tmp, `tai-history-${safeKey}.json`);
  state.historyFilePath = historyFilePath;
  if (!fs.existsSync(historyFilePath)) fs.writeFileSync(historyFilePath, '[]', { mode: 0o600 });
  const historyServerPath = path.join(tmp, `tai-mcp-history-${safeKey}.cjs`);
  fs.writeFileSync(historyServerPath, generateHistoryServerScript(historyFilePath), { mode: 0o755 });
  const servers: Record<string, any> = { ...(generateHistoryMcpConfig(historyServerPath) as any).mcpServers };

  const isRemoteExec = state.remoteTarget && state.remoteExecMode === 'auto';
  if (isRemoteExec && state.daemonEnabled) {
    const sshConfigPath = path.join(tmp, `tai-ssh-config-${safeKey}`);
    fs.writeFileSync(sshConfigPath, `Include ~/.ssh/config\nBatchMode yes\nStrictHostKeyChecking accept-new\n`, { mode: 0o600 });
    const mcpServerPath = path.join(tmp, `tai-mcp-server-${safeKey}.cjs`);
    fs.writeFileSync(mcpServerPath, generateMcpServerScript(state.remoteTarget!, sshConfigPath), { mode: 0o755 });
    Object.assign(servers, (generateMcpConfig(mcpServerPath) as any).mcpServers);
  }
  return servers;
}

function startQuery(win: BrowserWindow | null, key: string, firstMessage: string, model: string) {
  const state = getState(key);
  const cwd = state.cwd || process.cwd();
  const abort = new AbortController();
  state.abort = abort;
  state.busy = true;

  // --- streaming input queue ---
  const firstMsg: SDKUserMessage = { type: 'user', message: { role: 'user', content: firstMessage }, parent_tool_use_id: null };
  const pending: SDKUserMessage[] = [firstMsg];
  let notify: (() => void) | null = null;
  let ended = false;
  state.pushInput = (m) => { pending.push(m); notify?.(); };
  state.endInput = () => { ended = true; notify?.(); };

  async function* inputStream(): AsyncGenerator<SDKUserMessage> {
    while (true) {
      while (pending.length) yield pending.shift()!;
      if (ended) return;
      await new Promise<void>((r) => { notify = r; });
      notify = null;
    }
  }

  const isRemoteExec = !!(state.remoteTarget && state.remoteExecMode === 'auto');
  const mcpServers = buildMcpServers(state, key);
  const opts = sdkOptions({
    permMode: state.permMode || 'acceptEdits',
    model, cwd, sessionId: state.sessionId, remoteExec: isRemoteExec, mcpServers,
  });

  const watchdog = createIdleWatchdog({
    onIdle: () => {
      try { abort.abort(); } catch {}
      if (state.busy) {
        state.busy = false;
        safeSend(win, 'ai:error', key, 'AI provider timed out (no output for 120s).');
        safeSend(win, 'ai:message', key, { type: 'done' });
      }
    },
  });

  const q = query({
    prompt: inputStream(),
    options: {
      ...opts,
      abortController: abort,
      env: enrichedEnv(),
      canUseTool: async (toolName: string, input: Record<string, unknown>, o: { toolUseID: string }) => {
        // History tool is auto-allowed via allowedTools and never reaches here;
        // bypass modes also skip canUseTool. Anything that arrives needs a decision.
        const p = state.approvals.request(o.toolUseID);
        safeSend(win, 'ai:message', key, {
          type: 'approval_needed',
          toolUseId: o.toolUseID,
          toolName,
          command: toolCommandString(input as Record<string, any>),
          input,
        });
        return p;
      },
    },
  });

  (async () => {
    try {
      for await (const msg of q) {
        watchdog.kick();
        if ((msg as any).session_id) state.sessionId = (msg as any).session_id;
        for (const env of translateSdkMessage(msg)) safeSend(win, 'ai:message', key, env);
      }
    } catch (err: any) {
      const text = err?.message || String(err);
      const { category } = classifyProviderError(text);
      safeSend(win, 'ai:error', key, text, category);
      safeSend(win, 'ai:message', key, { type: 'done' });
    } finally {
      watchdog.cancel();
      state.busy = false;
      state.pushInput = null;
      state.endInput = null;
      state.abort = null;
      state.approvals.clear();
    }
  })();
}

export function setupClaudeService(getWindow: () => BrowserWindow | null) {
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

  ipcMain.handle('ai:send', (_event, key: string, cwd: string, message: string, permMode: string, model: string, _effort?: string) => {
    const win = getWindow();
    const state = getState(key);
    state.cwd = cwd;
    // A permission-mode change requires a fresh query (it's a query-create option).
    const permChanged = state.permMode !== null && state.permMode !== permMode;
    state.permMode = permMode;

    if (state.busy && state.pushInput && !permChanged) {
      // Continue the live conversation with another user turn.
      state.pushInput({ type: 'user', message: { role: 'user', content: message }, parent_tool_use_id: null });
      return;
    }
    if (state.busy && state.abort) {
      // Permission mode changed mid-flight — end the old query and start fresh.
      try { state.abort.abort(); } catch {}
    }
    startQuery(win, key, message, model);
  });

  ipcMain.on('ai:cancel', (_event, key: string) => {
    const state = getState(key);
    state.approvals.clear();
    try { state.abort?.abort(); } catch {}
  });

  ipcMain.on('ai:stop', (_event, key: string) => {
    const win = getWindow();
    const state = getState(key);
    state.approvals.clear();
    state.endInput?.();
    try { state.abort?.abort(); } catch {}
    if (state.busy) {
      state.busy = false;
      safeSend(win, 'ai:message', key, { type: 'done' });
    }
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

  ipcMain.handle('ai:approve', async (_event, key: string, toolUseId: string, approved: boolean) => {
    const state = getState(key);
    return state.approvals.resolve(toolUseId, approved);
  });

  ipcMain.handle('ai:setRemoteTarget', (_event, key: string, target: string | null, mode: string) => {
    console.log(`[daemon] setRemoteTarget key=${key} target=${target} mode=${mode}`);
    const state = getState(key);
    const wasRemote = state.remoteTarget && state.remoteExecMode === 'auto';
    state.remoteTarget = target;
    state.remoteExecMode = mode as 'auto' | 'local';
    const isRemote = state.remoteTarget && state.remoteExecMode === 'auto';

    if (wasRemote !== isRemote && state.abort) {
      try { state.abort.abort(); } catch {}
      state.abort = null;
      state.sessionId = null;
    }

    if (!target) {
      sshManager.disconnect(key);
    }
    return true;
  });
}

export function destroyAllClaude() {
  for (const state of claudeStates.values()) {
    try { state.approvals.clear(); } catch {}
    try { state.abort?.abort(); } catch {}
    state.busy = false;
    state.daemonProxy?.disconnect();
  }
  claudeStates.clear();
  sshManager.destroyAll();
}
