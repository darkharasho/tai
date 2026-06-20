# Claude Agent SDK Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hand-spawned `claude` CLI in `electron/services/claude.ts` with the official Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`), using its `canUseTool` callback for approvals and letting the SDK execute tools natively — fixing the broken approval flow on all platforms and the Windows Bash-approval failure.

**Architecture:** Per tab, run one long-lived streaming `query()`: an async input queue feeds user turns; the output generator streams `SDKMessage`s; a `canUseTool` callback gates every tool and is resolved by the existing `ai:approve` IPC. The renderer's `ai:message` protocol is preserved via a pure translation layer. The local path lets the SDK run tools natively (the Windows fix); the remote/daemon path routes tools through the existing daemon/SSH MCP server passed as SDK `mcpServers` + `disallowedTools`.

**Tech Stack:** Electron (main process), TypeScript, `@anthropic-ai/claude-agent-sdk`, Vitest (`npx vitest run --config tests/vitest.config.ts --maxWorkers=2`), electron-builder.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-06-20-claude-agent-sdk-migration-design.md`.
- Preserve the renderer `ai:message` protocol exactly: envelopes `{type:'assistant', message}`, `{type:'user', message}`, `{type:'approval_needed', toolUseId, toolName, command, input}`, `{type:'result', content}`, `{type:'done'}`, `{type:'error', text, category}`, and the `remote:*` events.
- Preserve all `ai:*` IPC signatures in `electron/preload.ts` (do not change channel names or argument order). `ai:approve(key, toolUseId, approved)`, `ai:send(key, cwd, message, permMode, model, effort?)`, `ai:cancel(key)`, `ai:stop(key)`, `ai:updateHistory(key, entries)`, `ai:setRemoteTarget(key, target, mode)`, `ai:setDaemonEnabled(key, enabled)`, `ai:models()`.
- Auth is the user's existing Claude login (the SDK reads `.claude` OAuth tokens). No API key. Do not add one.
- The SDK's `canUseTool` return shape is `{behavior:'allow', updatedInput?}` or `{behavior:'deny', message}`.
- `permissionMode` values: `'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'dontAsk' | 'auto'`. `bypassPermissions` requires `allowDangerouslySkipPermissions: true`.
- The read-only `mcp__tai-history__TerminalHistory` tool is always auto-approved (via `allowedTools`).
- Reuse existing helpers in `claude.ts` unchanged: `enrichedEnv()`, `toolCommandString()`, `classifyProviderError`, `generateHistoryServerScript`/`generateHistoryMcpConfig`, `generateMcpServerScript`/`generateMcpConfig`, `getAvailableClaudeModels`, `createIdleWatchdog`, `sshManager`/`toolProxy`/`RemoteDaemonProxy`.
- `effort` is NOT passed to the SDK in this migration (the Agent SDK options surface doesn't document it); the `ai:send` `effort` arg is accepted and ignored for now. Note this in the rewrite; it's a deliberate follow-up, not an omission.
- Test runner: `npx vitest run --config tests/vitest.config.ts --maxWorkers=2`.
- gemini.ts and Windows OSC-133 context capture are OUT OF SCOPE.

---

### Task 1: Add the SDK dependency and packaging entry

**Files:**
- Modify: `package.json` (dependencies + `build.asarUnpack`)

**Interfaces:**
- Consumes: nothing.
- Produces: `@anthropic-ai/claude-agent-sdk` importable from main-process code; its bundled binary unpacked from the asar in builds.

- [ ] **Step 1: Install the SDK as a dependency**

Run:
```bash
npm install @anthropic-ai/claude-agent-sdk
```
Expected: `@anthropic-ai/claude-agent-sdk` appears under `dependencies` in `package.json` and installs without error.

- [ ] **Step 2: Unpack the SDK's bundled binary from the asar**

The SDK ships a native Claude Code binary as an optional dependency; it must be unpacked so the spawned subprocess is executable in the packaged app. In `package.json`, extend `build.asarUnpack` (currently lines ~63-66) to:

```json
    "asarUnpack": [
      "node_modules/node-pty/**/*",
      "node_modules/node-termios/**/*",
      "node_modules/@anthropic-ai/claude-agent-sdk/**/*",
      "node_modules/@anthropic-ai/**/*"
    ],
```

- [ ] **Step 3: Verify the package imports in the main process build**

Create a throwaway check and run the TypeScript build:
```bash
node -e "require('@anthropic-ai/claude-agent-sdk'); console.log('sdk-ok')"
```
Expected: prints `sdk-ok` (the package resolves). If it prints an error about a missing binary, that is fine for now — runtime binary resolution is handled in Task 5/6; this step only confirms the JS entrypoint resolves.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "build(ai): add @anthropic-ai/claude-agent-sdk dependency and unpack its binary"
```

---

### Task 2: `sdkOptions` — pure permission-mode/remote → SDK options mapping

**Files:**
- Create: `electron/services/claudeSdkOptions.ts`
- Test: `tests/unit/claudeSdkOptions.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface SdkOptionsInput { permMode: string; model: string; cwd: string; sessionId: string | null; remoteExec: boolean; mcpServers: Record<string, unknown>; }`
  - `interface SdkOptionsResult { permissionMode: 'default'|'acceptEdits'|'bypassPermissions'; allowDangerouslySkipPermissions?: boolean; allowedTools: string[]; disallowedTools?: string[]; model?: string; resume?: string; cwd: string; mcpServers: Record<string, unknown>; }`
  - `const HISTORY_TOOL = 'mcp__tai-history__TerminalHistory'`
  - `const REMOTE_DISALLOWED = ['Bash','Read','Write','Edit','Grep','Glob','WebFetch','WebSearch']`
  - `function sdkOptions(input: SdkOptionsInput): SdkOptionsResult`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/claudeSdkOptions.test.ts
import { describe, it, expect } from 'vitest';
import { sdkOptions, HISTORY_TOOL, REMOTE_DISALLOWED } from '../../electron/services/claudeSdkOptions';

const base = { model: 'default', cwd: '/home/u', sessionId: null, remoteExec: false, mcpServers: { 'tai-history': {} } };

describe('sdkOptions', () => {
  it('ask mode → default permission, history tool auto-allowed, no model when default', () => {
    const r = sdkOptions({ ...base, permMode: 'ask' });
    expect(r.permissionMode).toBe('default');
    expect(r.allowedTools).toContain(HISTORY_TOOL);
    expect(r.model).toBeUndefined();
    expect(r.cwd).toBe('/home/u');
    expect(r.mcpServers).toEqual({ 'tai-history': {} });
  });

  it('acceptEdits mode → acceptEdits permission', () => {
    expect(sdkOptions({ ...base, permMode: 'acceptEdits' }).permissionMode).toBe('acceptEdits');
  });

  it('bypass mode → bypassPermissions + allowDangerouslySkipPermissions', () => {
    const r = sdkOptions({ ...base, permMode: 'bypass' });
    expect(r.permissionMode).toBe('bypassPermissions');
    expect(r.allowDangerouslySkipPermissions).toBe(true);
  });

  it('remoteExec → bypassPermissions and built-in tools disallowed', () => {
    const r = sdkOptions({ ...base, permMode: 'acceptEdits', remoteExec: true });
    expect(r.permissionMode).toBe('bypassPermissions');
    expect(r.allowDangerouslySkipPermissions).toBe(true);
    expect(r.disallowedTools).toEqual(REMOTE_DISALLOWED);
  });

  it('passes an explicit model through and omits "default"', () => {
    expect(sdkOptions({ ...base, permMode: 'ask', model: 'opus' }).model).toBe('opus');
    expect(sdkOptions({ ...base, permMode: 'ask', model: 'default' }).model).toBeUndefined();
  });

  it('sets resume from a non-null sessionId', () => {
    expect(sdkOptions({ ...base, permMode: 'ask', sessionId: 'sess-1' }).resume).toBe('sess-1');
    expect(sdkOptions({ ...base, permMode: 'ask', sessionId: null }).resume).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config tests/vitest.config.ts tests/unit/claudeSdkOptions.test.ts --maxWorkers=2`
Expected: FAIL — cannot find module `claudeSdkOptions`.

- [ ] **Step 3: Write the implementation**

```typescript
// electron/services/claudeSdkOptions.ts

/** The read-only terminal-history MCP tool is always auto-approved. */
export const HISTORY_TOOL = 'mcp__tai-history__TerminalHistory';

/** Built-in tools disallowed on the remote-exec path so the model uses the
 *  remote MCP toolset (whose calls run on the remote host) instead. */
export const REMOTE_DISALLOWED = ['Bash', 'Read', 'Write', 'Edit', 'Grep', 'Glob', 'WebFetch', 'WebSearch'];

export interface SdkOptionsInput {
  permMode: string;
  model: string;
  cwd: string;
  sessionId: string | null;
  remoteExec: boolean;
  mcpServers: Record<string, unknown>;
}

export interface SdkOptionsResult {
  permissionMode: 'default' | 'acceptEdits' | 'bypassPermissions';
  allowDangerouslySkipPermissions?: boolean;
  allowedTools: string[];
  disallowedTools?: string[];
  model?: string;
  resume?: string;
  cwd: string;
  mcpServers: Record<string, unknown>;
}

/**
 * Map TAI's permission mode + remote context to Claude Agent SDK options.
 * - ask         → default      (canUseTool prompts for every tool)
 * - acceptEdits → acceptEdits  (file edits auto; canUseTool prompts for Bash etc.)
 * - bypass      → bypassPermissions
 * - remoteExec  → bypassPermissions + built-ins disallowed (routed via MCP)
 */
export function sdkOptions(input: SdkOptionsInput): SdkOptionsResult {
  const { permMode, model, cwd, sessionId, remoteExec, mcpServers } = input;

  let permissionMode: SdkOptionsResult['permissionMode'];
  if (remoteExec || permMode === 'bypass') permissionMode = 'bypassPermissions';
  else if (permMode === 'ask') permissionMode = 'default';
  else permissionMode = 'acceptEdits';

  const result: SdkOptionsResult = {
    permissionMode,
    allowedTools: [HISTORY_TOOL],
    cwd,
    mcpServers,
  };
  if (permissionMode === 'bypassPermissions') result.allowDangerouslySkipPermissions = true;
  if (remoteExec) result.disallowedTools = REMOTE_DISALLOWED;
  if (model && model !== 'default') result.model = model;
  if (sessionId) result.resume = sessionId;
  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config tests/vitest.config.ts tests/unit/claudeSdkOptions.test.ts --maxWorkers=2`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add electron/services/claudeSdkOptions.ts tests/unit/claudeSdkOptions.test.ts
git commit -m "feat(ai): pure permission-mode → Claude Agent SDK options mapping"
```

---

### Task 3: `translateSdkMessage` — pure SDK message → renderer envelope mapping

**Files:**
- Create: `electron/services/claudeSdkTranslate.ts`
- Test: `tests/unit/claudeSdkTranslate.test.ts`

**Interfaces:**
- Consumes: `classifyProviderError` from `../../src/utils/classifyProviderError`.
- Produces:
  - `type RendererMsg = { type: string; [k: string]: any }`
  - `function translateSdkMessage(msg: any): RendererMsg[]` — returns the envelopes to forward over `ai:message` for one SDK message (may be empty).

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/claudeSdkTranslate.test.ts
import { describe, it, expect } from 'vitest';
import { translateSdkMessage } from '../../electron/services/claudeSdkTranslate';

describe('translateSdkMessage', () => {
  it('assistant message → {type:assistant, message}', () => {
    const m = { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] } };
    expect(translateSdkMessage(m)).toEqual([{ type: 'assistant', message: m.message }]);
  });

  it('user (tool_result) message → {type:user, message}', () => {
    const m = { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } };
    expect(translateSdkMessage(m)).toEqual([{ type: 'user', message: m.message }]);
  });

  it('successful result → {type:result} then {type:done}', () => {
    const m = { type: 'result', subtype: 'success', result: 'done', total_cost_usd: 0.01 };
    expect(translateSdkMessage(m)).toEqual([{ type: 'result', content: m }, { type: 'done' }]);
  });

  it('error result → {type:error} then {type:done}', () => {
    const m = { type: 'result', subtype: 'error_during_execution', result: 'boom' };
    const out = translateSdkMessage(m);
    expect(out[0].type).toBe('error');
    expect(out[0].text).toContain('boom');
    expect(out[1]).toEqual({ type: 'done' });
  });

  it('ignored message types → []', () => {
    expect(translateSdkMessage({ type: 'system', subtype: 'init' })).toEqual([]);
    expect(translateSdkMessage({ type: 'tool_progress' })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config tests/vitest.config.ts tests/unit/claudeSdkTranslate.test.ts --maxWorkers=2`
Expected: FAIL — cannot find module `claudeSdkTranslate`.

- [ ] **Step 3: Write the implementation**

```typescript
// electron/services/claudeSdkTranslate.ts
import { classifyProviderError } from '../../src/utils/classifyProviderError';

export type RendererMsg = { type: string; [k: string]: any };

/**
 * Translate one Claude Agent SDK output message into the renderer's existing
 * ai:message envelopes. Assistant/user messages carry standard Anthropic
 * content blocks the renderer already parses, so they pass through under the
 * same envelope. A final `result` is split into a result echo + a `done`.
 * Unknown / progress / system messages are dropped.
 */
export function translateSdkMessage(msg: any): RendererMsg[] {
  if (!msg || typeof msg !== 'object') return [];
  switch (msg.type) {
    case 'assistant':
      return msg.message ? [{ type: 'assistant', message: msg.message }] : [];
    case 'user':
      return msg.message ? [{ type: 'user', message: msg.message }] : [];
    case 'result': {
      if (msg.subtype && msg.subtype !== 'success') {
        const text = typeof msg.result === 'string' ? msg.result : `AI error (${msg.subtype})`;
        const { category } = classifyProviderError(text);
        return [{ type: 'error', text, category }, { type: 'done' }];
      }
      return [{ type: 'result', content: msg }, { type: 'done' }];
    }
    default:
      return [];
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config tests/vitest.config.ts tests/unit/claudeSdkTranslate.test.ts --maxWorkers=2`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add electron/services/claudeSdkTranslate.ts tests/unit/claudeSdkTranslate.test.ts
git commit -m "feat(ai): pure SDK-message → renderer-envelope translation"
```

---

### Task 4: `ApprovalBridge` — canUseTool ↔ ai:approve

**Files:**
- Create: `electron/services/claudeApprovalBridge.ts`
- Test: `tests/unit/claudeApprovalBridge.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type PermissionResult = { behavior: 'allow' } | { behavior: 'deny'; message: string }`
  - `class ApprovalBridge { request(toolUseId: string): Promise<PermissionResult>; resolve(toolUseId: string, approved: boolean): boolean; clear(): void; }`
  - `request` registers a pending resolver and returns a Promise; `resolve` settles it (`true`→allow, `false`→deny) and returns whether a pending entry existed; `clear` denies and drops all pending.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/claudeApprovalBridge.test.ts
import { describe, it, expect } from 'vitest';
import { ApprovalBridge } from '../../electron/services/claudeApprovalBridge';

describe('ApprovalBridge', () => {
  it('resolve(true) settles the request as allow', async () => {
    const b = new ApprovalBridge();
    const p = b.request('t1');
    expect(b.resolve('t1', true)).toBe(true);
    expect(await p).toEqual({ behavior: 'allow' });
  });

  it('resolve(false) settles the request as deny with a message', async () => {
    const b = new ApprovalBridge();
    const p = b.request('t2');
    b.resolve('t2', false);
    const r = await p;
    expect(r.behavior).toBe('deny');
    expect((r as any).message).toBeTruthy();
  });

  it('resolve on an unknown id returns false', () => {
    const b = new ApprovalBridge();
    expect(b.resolve('nope', true)).toBe(false);
  });

  it('clear() denies all pending requests', async () => {
    const b = new ApprovalBridge();
    const p = b.request('t3');
    b.clear();
    expect((await p).behavior).toBe('deny');
    expect(b.resolve('t3', true)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config tests/vitest.config.ts tests/unit/claudeApprovalBridge.test.ts --maxWorkers=2`
Expected: FAIL — cannot find module `claudeApprovalBridge`.

- [ ] **Step 3: Write the implementation**

```typescript
// electron/services/claudeApprovalBridge.ts

export type PermissionResult = { behavior: 'allow' } | { behavior: 'deny'; message: string };

const DENY: PermissionResult = { behavior: 'deny', message: 'User denied the tool use.' };

/**
 * Bridges the SDK's canUseTool callback to the renderer's ai:approve IPC.
 * canUseTool calls `request(toolUseId)` and awaits the returned promise; the
 * renderer's Approve/Deny button drives `resolve(toolUseId, approved)`.
 */
export class ApprovalBridge {
  private _pending = new Map<string, (r: PermissionResult) => void>();

  request(toolUseId: string): Promise<PermissionResult> {
    return new Promise<PermissionResult>((resolve) => {
      this._pending.set(toolUseId, resolve);
    });
  }

  resolve(toolUseId: string, approved: boolean): boolean {
    const fn = this._pending.get(toolUseId);
    if (!fn) return false;
    this._pending.delete(toolUseId);
    fn(approved ? { behavior: 'allow' } : DENY);
    return true;
  }

  clear(): void {
    for (const fn of this._pending.values()) fn(DENY);
    this._pending.clear();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config tests/vitest.config.ts tests/unit/claudeApprovalBridge.test.ts --maxWorkers=2`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add electron/services/claudeApprovalBridge.ts tests/unit/claudeApprovalBridge.test.ts
git commit -m "feat(ai): ApprovalBridge linking canUseTool to ai:approve"
```

---

### Task 5: Rewrite `claude.ts` to drive the Agent SDK

**Files:**
- Modify: `electron/services/claude.ts` (rewrite the engine; keep the named helpers listed in Global Constraints)

**Interfaces:**
- Consumes: `sdkOptions`/`HISTORY_TOOL` (Task 2), `translateSdkMessage` (Task 3), `ApprovalBridge` (Task 4), and existing helpers (`enrichedEnv`, `toolCommandString`, `generateHistory*`, `generateMcpServerScript`/`generateMcpConfig`, `getAvailableClaudeModels`, `createIdleWatchdog`, `RemoteDaemonProxy`/`toolProxy`).
- Produces: unchanged `ai:*` IPC behavior and the `ai:message` protocol; `setupClaudeService(getWindow)` and `destroyAllClaude()` exports preserved.

This task has no new unit test (the extracted logic is covered by Tasks 2–4; the SDK subprocess and IPC wiring are verified by Tasks 6–7). Verification is `npx tsc --noEmit` clean + the full existing suite green.

- [ ] **Step 1: Replace the per-tab state shape**

Replace the `PendingToolUse` interface and `ClaudeState` interface (lines ~20-45) and `getState` initializer (lines ~49-56) with an SDK-driven state. Add the imports at the top (after the existing imports):

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk';
import { sdkOptions, HISTORY_TOOL } from './claudeSdkOptions';
import { translateSdkMessage } from './claudeSdkTranslate';
import { ApprovalBridge } from './claudeApprovalBridge';
```

New state shape (replace the old interfaces + initializer):

```typescript
type SdkUserMessage = { type: 'user'; message: { role: 'user'; content: string } };

interface ClaudeState {
  /** Pushes the next queued user turn into the live query; null when idle. */
  pushInput: ((m: SdkUserMessage) => void) | null;
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
```

- [ ] **Step 2: Add the async input queue + query driver**

Add this helper above `setupClaudeService`. It builds the streaming-input async iterable, starts `query()`, wires `canUseTool` to the `ApprovalBridge`, and pumps translated output to the renderer. Reuse the existing MCP-config builders for history (and, when remote-exec, the remote server) exactly as the old code did — write the temp server scripts the same way, then pass them via `mcpServers` instead of `--mcp-config`.

```typescript
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
  const pending: SdkUserMessage[] = [{ type: 'user', message: { role: 'user', content: firstMessage } }];
  let notify: (() => void) | null = null;
  let ended = false;
  state.pushInput = (m) => { pending.push(m); notify?.(); };
  state.endInput = () => { ended = true; notify?.(); };

  async function* inputStream(): AsyncGenerator<SdkUserMessage> {
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
```

Note: if the SDK option name for the abort handle differs from `abortController`, use the SDK's documented name (the Query also exposes `q.interrupt()` — see Step 4). Keep `enrichedEnv()` passed through `options.env` so PATH/login env reaches the subprocess.

- [ ] **Step 3: Rewrite `ai:send` to start or continue the streaming query**

Replace the `ai:send` handler (~line 473) with:

```typescript
  ipcMain.handle('ai:send', (_event, key: string, cwd: string, message: string, permMode: string, model: string, _effort?: string) => {
    const win = getWindow();
    const state = getState(key);
    state.cwd = cwd;
    // A permission-mode change requires a fresh query (it's a query-create option).
    const permChanged = state.permMode !== null && state.permMode !== permMode;
    state.permMode = permMode;

    if (state.busy && state.pushInput && !permChanged) {
      // Continue the live conversation with another user turn.
      state.pushInput({ type: 'user', message: { role: 'user', content: message } });
      return;
    }
    if (state.busy && state.abort) {
      // Permission mode changed mid-flight — end the old query and start fresh.
      try { state.abort.abort(); } catch {}
    }
    startQuery(win, key, message, model);
  });
```

- [ ] **Step 4: Rewrite `ai:approve`, `ai:stop`, `ai:cancel`**

Replace the entire `ai:approve` handler (~lines 532-696, including the deleted local-execution block) with:

```typescript
  ipcMain.handle('ai:approve', async (_event, key: string, toolUseId: string, approved: boolean) => {
    const state = getState(key);
    return state.approvals.resolve(toolUseId, approved);
  });
```

Replace `ai:stop` (~line 504) with:

```typescript
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
```

Replace `ai:cancel` (~line 493) with the same body as `ai:stop` (cancel is the in-flight interrupt; it must also clear approvals and abort):

```typescript
  ipcMain.on('ai:cancel', (_event, key: string) => {
    const state = getState(key);
    state.approvals.clear();
    try { state.abort?.abort(); } catch {}
  });
```

- [ ] **Step 5: Delete the dead engine code and update `destroyAllClaude`**

Remove, in `claude.ts`:
- the `ensureProcess` function and all `proc.stdout/stderr/on('exit')` stream-json parsing,
- the denial-string detection block,
- the local tool re-implementation (Bash `execFile`, Write/Edit/Read via `fs`, unknown-tool settings.local.json writer),
- `handleRemoteToolCalls`'s dependence on the old `state.process`/`safeWrite` (the remote path now flows through the MCP server; keep `RemoteDaemonProxy`/`toolProxy` wiring used by `ai:setDaemonEnabled` but drop any code that writes tool results back into a child `process`),
- the now-unused imports `spawn`, `execFile`, `ChildProcess`, `resolveBinary`, `safeWrite` (remove only those that are genuinely unused after the rewrite).

Update `destroyAllClaude` (~line 723) to abort each live query:

```typescript
export function destroyAllClaude() {
  for (const state of claudeStates.values()) {
    try { state.approvals.clear(); } catch {}
    try { state.abort?.abort(); } catch {}
    state.busy = false;
  }
  claudeStates.clear();
}
```

- [ ] **Step 6: Typecheck and run the full suite**

Run: `npx tsc --noEmit && npx vitest run --config tests/vitest.config.ts --maxWorkers=2`
Expected: typecheck clean; all existing tests plus Tasks 2-4 pass. Fix any unused-import or type errors surfaced by the rewrite. If `tsc` reports an unknown SDK option name (e.g. `abortController`/`env`/`canUseTool`), correct it against the installed SDK's type definitions in `node_modules/@anthropic-ai/claude-agent-sdk` — do not guess; read the exported `Options` type.

- [ ] **Step 7: Commit**

```bash
git add electron/services/claude.ts
git commit -m "feat(ai): drive Claude provider via the Agent SDK with canUseTool approvals"
```

---

### Task 6: Package the SDK binary and verify in a built app

**Files:** none (build verification; may add `pathToClaudeCodeExecutable` resolution to `claude.ts` if needed).

Automated tests can't cover the packaged-app binary resolution; this is a manual gate that must pass before release.

- [ ] **Step 1: Build a local Linux artifact**

Run: `npm run dist`
Expected: an AppImage is produced in `release/` with no electron-builder errors about the `@anthropic-ai` files.

- [ ] **Step 2: Launch the built AppImage and run one AI turn**

Launch the AppImage, open a tab, and ask the AI to run a trivial Bash command (e.g. "run `echo hi`"). Approve it.
Expected: the approval popup appears, Approve runs the command via the SDK, and the result streams back. If the SDK cannot find its bundled binary inside the packaged app, set `options.pathToClaudeCodeExecutable` in `startQuery` to the unpacked path (resolve under `process.resourcesPath` / `app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk/...`), rebuild, and re-verify.

- [ ] **Step 3: Commit any packaging fix**

```bash
git add -A && git commit -m "build(ai): resolve bundled Claude Code binary in packaged app"
```

(If no fix was needed, skip the commit and note that in the report.)

---

### Task 7: Manual smoke gate (Linux and Windows)

**Files:** none (manual).

Run the app (`npm run dev`) on Linux, and the built installer on Windows, and verify:

- [ ] **Step 1: ask mode, approve.** Set permission mode to ask. Ask the AI to run `echo hi` via Bash → approval popup shows → Approve → command runs, output streams, AI continues.
- [ ] **Step 2: ask mode, deny.** Ask for another Bash command → Deny → the tool does not run and the AI acknowledges the denial (no hang).
- [ ] **Step 3: acceptEdits.** In acceptEdits mode, ask the AI to create a file (auto-runs, no popup) and to run a Bash command (popup still shows).
- [ ] **Step 4: multi-turn.** After a completed turn, send a second message → it continues the same conversation (context retained).
- [ ] **Step 5: stop mid-tool.** Start a long Bash command, approve it, then hit Stop → the run aborts and the UI returns to idle.
- [ ] **Step 6: Windows specifically.** Repeat Steps 1-2 on Windows. Approving a Bash command **runs it via the SDK** (no `bash` ENOENT, the previous failure).
- [ ] **Step 7: remote-exec.** With a remote target + daemon enabled, ask for a command → it executes on the remote host (routed through the MCP server), not locally.

- [ ] **Step 8: Commit any fixes found during smoke.**

```bash
git add -A && git commit -m "fix(ai): address manual-smoke findings for Agent SDK migration"
```

---

## Self-Review

**Spec coverage:**
- SDK dependency + bundled binary packaging → Tasks 1, 6. ✔
- `sdkOptions` pure mapping → Task 2. ✔
- `translateSdkMessage` pure mapping (renderer protocol preserved) → Task 3. ✔
- `ApprovalBridge` (canUseTool ↔ ai:approve) → Task 4. ✔
- claude.ts rewrite: streaming query, canUseTool approvals, native tool exec, session resume, remote/daemon via mcpServers+disallowedTools → Task 5. ✔
- Deletions (denial detection, local tool re-impl, stream-json parsing, approvalBuffered, resolveBinary) → Task 5 Step 5. ✔
- Permission-mode mapping table → Task 2 (logic) + Task 5 (applied). ✔
- Error handling / lifecycle (result error → ai:error, stop/abort, watchdog) → Tasks 3, 5. ✔
- Auth unchanged (no API key) → Task 1/5 (SDK default auth; `env` passthrough). ✔
- Testing (unit + manual gate Linux/Windows) → Tasks 2-4 unit, Tasks 6-7 manual. ✔
- Packaging risk → Task 6. ✔
- gemini.ts / OSC-133 out of scope → not tasked (correct). ✔
- `effort` deliberately ignored → Global Constraints + Task 5 Step 3 (`_effort`). ✔

**Placeholder scan:** none — every code/command step is concrete. The two "if the SDK option name differs / if the binary isn't found" notes are explicit fallbacks tied to reading the installed SDK types, not deferred work.

**Type consistency:** `sdkOptions`/`SdkOptionsResult`/`HISTORY_TOOL`/`REMOTE_DISALLOWED` (Task 2) consumed in Task 5. `translateSdkMessage` returning `RendererMsg[]` (Task 3) consumed in the Task 5 output loop. `ApprovalBridge.request/resolve/clear` + `PermissionResult` (Task 4) consumed by `canUseTool` and `ai:approve`/`ai:stop` (Task 5). `ai:*` IPC signatures unchanged. ✔
