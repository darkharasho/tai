# Codex & Gemini Provider Support for TAI

## Overview

Add Codex (OpenAI CLI) and Gemini (Google CLI via ACP) as first-class AI providers in TAI, ported from SAI's battle-tested implementation. Includes a permission badge on the input box and provider SVG icons.

## Approach

Direct port from SAI, adapted to TAI's tab-keyed state model (instead of SAI's workspace-scoped state). All three providers emit events on the same `ai:message` IPC channel using a unified message format, so the frontend needs minimal changes to consume Codex/Gemini output.

## 1. Backend Services

### New Files

- **`electron/services/codex.ts`** — Codex subprocess management and event translation
- **`electron/services/gemini.ts`** — Gemini ACP session management and event translation
- **`electron/services/gemini-acp.ts`** — JSON-RPC 2.0 transport client for `gemini --acp`

### Codex Service (`codex.ts`)

State per tab key:

```typescript
interface CodexState {
  process: ChildProcess | null;
  sessionId: string | null;
  buffer: string;
  busy: boolean;
}
```

IPC handlers:
- `codex:send(key, cwd, message, permMode, model)` — Spawns `codex exec --json` (or `codex exec resume --json <sessionId>` for subsequent turns). Permission mapping:
  - `auto` → `--full-auto`
  - `read-only` → `--sandbox read-only`
  - `full-access` → `--dangerously-bypass-approvals-and-sandbox`
- `codex:stop(key)` — Kills the process, sends `done` event
- `codex:setSessionId(key, sessionId)` — Manually set/clear session for conversation continuity

Event translation (NDJSON from stdout):
- `thread.started` → `{ type: 'session_id', sessionId }`
- `item.started` (command_execution) → `{ type: 'assistant', message.content: [{ type: 'tool_use', name: 'Bash' }] }`
- `item.started` (file_change) → `{ type: 'assistant', message.content: [{ type: 'tool_use', name: 'Edit' }] }`
- `item.completed` (agent_message) → `{ type: 'assistant', message.content: [{ type: 'text' }] }`
- `item.completed` (command_execution) → `{ type: 'user', message.content: [{ type: 'tool_result' }] }`
- `turn.completed` → `{ type: 'result' }` + `{ type: 'done' }`
- `turn.failed` / `error` → `{ type: 'error' }` + `{ type: 'done' }`

All translated events emitted on the `ai:message` channel with the tab key, matching Claude's pattern.

### Gemini ACP Client (`gemini-acp.ts`)

Direct port from SAI. Spawns `gemini --acp`, communicates via JSON-RPC 2.0 over stdin/stdout.

```typescript
interface GeminiAcpClient {
  start(): Promise<void>;
  request<T>(method: string, params?: Record<string, unknown>): Promise<T>;
  notify(method: string, params?: Record<string, unknown>): void;
  onEvent(listener: (event: unknown) => void): () => void;
  dispose(): void;
}
```

Lifecycle:
1. `start()` — Spawns process, sends `initialize` with `protocolVersion: 1`, resolves on success
2. `request()` — Sends JSON-RPC request with auto-incrementing ID, returns promise
3. `onEvent()` — Receives JSON-RPC notifications (no `id` field) from the process
4. `dispose()` — Kills process, rejects all pending requests

### Gemini Service (`gemini.ts`)

State per tab key:

```typescript
interface GeminiState {
  transport: GeminiAcpClient | null;
  sessionId: string | null;
  cwd: string;
  busy: boolean;
  availability: 'available' | 'disabled';
  lastError: string | undefined;
  pendingApproval: { toolUseId: string; toolName: string; input: any } | null;
  bootstrapped: boolean;
}
```

IPC handlers:
- `gemini:send(key, cwd, message, approvalMode, model)` — Ensures transport → ensures session → sends `session/prompt`. Approval mode mapping from TAI trust levels happens in the frontend provider.
- `gemini:stop(key)` — Sends `session/cancel` via ACP, resets busy state
- `gemini:approve(key, toolUseId, approved)` — Sends `tool/approve` via ACP
- `gemini:setSessionId(key, sessionId)` — Manually set/clear session

Event translation (ACP notifications):
- `session/update` (agent_message_chunk) → `{ type: 'assistant', message.content: [{ type: 'text', delta: true }] }`
- `session/update` (tool_call) → `{ type: 'assistant', message.content: [{ type: 'tool_use' }] }`
- `session/update` (tool_call_update) → `{ type: 'user', message.content: [{ type: 'tool_result' }] }`
- `tool/approvalRequired` → `{ type: 'approval_needed', toolUseId, toolName, command }`
- `tool/call` → `{ type: 'assistant', message.content: [{ type: 'tool_use' }] }`
- `tool/result` → `{ type: 'user', message.content: [{ type: 'tool_result' }] }`

**Availability state machine:** If transport startup or any request fails, `disableGemini()` disposes the transport, sets `availability: 'disabled'`, stores `lastError`, and emits error+done. Re-selecting Gemini resets availability and retries.

**Project bootstrap:** First prompt per session prepends project context (top-level directory listing, shallow file map, key file snippets from README.md, package.json, GEMINI.md, CLAUDE.md, tsconfig.json). Tracked via `bootstrapped` flag per session.

### Registration in `electron/main.ts`

```typescript
import { setupCodexService, destroyAllCodex } from './services/codex';
import { setupGeminiService, destroyAllGemini } from './services/gemini';

// In app.whenReady():
setupCodexService(() => mainWindow);
setupGeminiService(() => mainWindow);

// In before-quit:
destroyAllCodex();
destroyAllGemini();
```

## 2. IPC Layer (Preload)

Extend `window.tai` in `electron/preload.ts`:

```typescript
codex: {
  send: (key, cwd, message, permMode, model) =>
    ipcRenderer.invoke('codex:send', key, cwd, message, permMode, model),
  stop: (key) => ipcRenderer.send('codex:stop', key),
  setSessionId: (key, sessionId) =>
    ipcRenderer.send('codex:setSessionId', key, sessionId),
},
gemini: {
  send: (key, cwd, message, approvalMode, model) =>
    ipcRenderer.invoke('gemini:send', key, cwd, message, approvalMode, model),
  stop: (key) => ipcRenderer.send('gemini:stop', key),
  approve: (key, toolUseId, approved) =>
    ipcRenderer.invoke('gemini:approve', key, toolUseId, approved),
  setSessionId: (key, sessionId) =>
    ipcRenderer.send('gemini:setSessionId', key, sessionId),
},
```

All providers share `ai:message` and `ai:error` channels for streaming events. Existing `ai.onMessage` and `ai.onError` listeners filter by tab key and remain unchanged.

## 3. Frontend Provider Layer

### New Type

In `src/types.ts`:

```typescript
export type AIProvider = 'claude' | 'codex' | 'gemini';
```

Add `aiProvider: AIProvider` to `TabState` (default: `'claude'`).

### New Provider Files

**`src/providers/codex.ts`** — `createCodexProvider(tabId): Provider`

Calls `window.tai.codex.*`. The `send()` method maps TAI's `TrustLevel` to Codex permission modes:
- `ask` → `'auto'`
- `approve-edits` → `'read-only'`
- `bypass` → `'full-access'`

Uses `window.tai.ai.onMessage(tabId, callback)` for receiving events (shared channel).

**`src/providers/gemini.ts`** — `createGeminiProvider(tabId): Provider`

Calls `window.tai.gemini.*`. The `send()` method maps TAI's `TrustLevel` to Gemini approval modes:
- `ask` → `'default'`
- `approve-edits` → `'auto_edit'`
- `bypass` → `'yolo'`

Approval uses `window.tai.gemini.approve()` instead of `window.tai.ai.approve()`.

### Provider Selection in `TerminalSession.tsx`

Replace hardcoded `createClaudeProvider(tabId)` with dynamic creation based on `aiProvider` prop:

```typescript
function createProvider(provider: AIProvider, tabId: string): Provider {
  switch (provider) {
    case 'codex': return createCodexProvider(tabId);
    case 'gemini': return createGeminiProvider(tabId);
    default: return createClaudeProvider(tabId);
  }
}
```

When `aiProvider` changes, stop the current provider and create a new one. Add `aiProvider` to `TerminalSessionProps`.

Approval handler for Gemini uses `window.tai.gemini.approve()` — detect via `providerRef.current.id`.

## 4. Permission Badge on Input Box

### Location

Right side of the input row in `TerminalInput.tsx`, between the input field and the existing Shift+Tab hint. Only visible in AI mode.

### New Props on TerminalInput

```typescript
aiProvider?: AIProvider;
trustLevel?: TrustLevel;
onTrustLevelChange?: (level: TrustLevel) => void;
```

### Behavior

Click cycles through trust levels: `ask` → `approve-edits` → `bypass` → `ask`.

The badge displays provider-specific labels:

| TrustLevel | Claude | Codex | Gemini |
|---|---|---|---|
| `ask` | Default | Auto | Default |
| `approve-edits` | Auto Edits | Read-only | Auto Edit |
| `bypass` | Bypass | Full Access | Yolo |

### Visual Style

```css
.permissionBadge {
  font-size: 11px;
  padding: 3px 8px;
  border: 1px solid transparent;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s;
  display: flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
}
.permissionBadge.danger {
  color: var(--color-error, #e35535);
  border-color: var(--color-error, #e35535);
  background: rgba(227, 85, 53, 0.1);
}
```

- Default/safe modes: `ShieldCheck` icon (Lucide), muted text
- Bypass/dangerous modes: `ShieldOff` icon (Lucide), red styling

## 5. Provider Selector & Icons

### SVG Icons

Copy from SAI's `public/svg/` into TAI's `public/svg/`:
- `claude.svg` — 16x16, fill: #D4A27F
- `openai.svg` — 16x16, fill: #FFFFFF (used for Codex)
- `Google-gemini-icon.svg` — 16x16, radial gradient

### QuickSettings Enhancement

Add provider selector to `QuickSettings.tsx`:

```typescript
<SettingRow label="Provider" value={
  <select value={activeTab.aiProvider} onChange={...}>
    <option value="claude">Claude</option>
    <option value="codex">Codex</option>
    <option value="gemini">Gemini</option>
  </select>
} />
```

Changing provider updates `TabState.aiProvider` and stops any running AI process.

### SettingsOverlay Update

Update `SettingsOverlay.tsx` AI section to show provider dropdown instead of hardcoded "Claude".

### Provider Icons in UI

Use CSS mask-image pattern (matching SAI) for provider icons in QuickSettings and anywhere provider identity is shown:

```css
.provider-icon {
  width: 14px;
  height: 14px;
  mask-size: contain;
  mask-repeat: no-repeat;
  mask-position: center;
  background-color: currentColor;
}
```

## 6. Gemini Hardening

### Availability State Machine

- `available` → normal operation
- `disabled` → transport failed, `lastError` stored
- Transition to disabled: `disableGemini()` disposes transport, clears sessions, emits error+done
- Recovery: re-selecting Gemini as provider resets to `available` and retries transport

### Project Bootstrap

On first prompt per session, prepend context:
- Top-level directory listing (first 40 entries)
- Shallow project map (120 entries, depth 2, excluding .git/node_modules/dist)
- Key file snippets (first 2000 chars of README.md, package.json, GEMINI.md, CLAUDE.md, tsconfig.json)

Tracked per-session via `bootstrapped` flag — only sent once.

### Approval Flow

Gemini's `tool/approvalRequired` ACP events → TAI's `approval_needed` message type → existing approval prompt UI. Backend stores `pendingApproval` state, sends `tool/approve` back via ACP when user responds.

## Files Changed (Summary)

### New Files
- `electron/services/codex.ts`
- `electron/services/gemini.ts`
- `electron/services/gemini-acp.ts`
- `src/providers/codex.ts`
- `src/providers/gemini.ts`
- `public/svg/claude.svg`
- `public/svg/openai.svg`
- `public/svg/Google-gemini-icon.svg`

### Modified Files
- `electron/main.ts` — Register new services
- `electron/preload.ts` — Add codex/gemini IPC namespaces
- `src/types.ts` — Add `AIProvider` type, extend `TabState`
- `src/App.tsx` — Add `aiProvider` to tab state, provider change handler
- `src/components/TerminalSession.tsx` — Dynamic provider creation, provider-aware approval
- `src/components/TerminalInput.tsx` — Permission badge, new props
- `src/components/TerminalInput.module.css` — Permission badge styles
- `src/components/QuickSettings.tsx` — Provider selector
- `src/components/SettingsOverlay.tsx` — Provider dropdown in AI section
