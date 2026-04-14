# Codex & Gemini Provider Support — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Codex (OpenAI CLI) and Gemini (Google CLI via ACP) as first-class AI providers in TAI, with a permission badge on the input box and provider SVG icons.

**Architecture:** Direct port from SAI's provider services adapted to TAI's tab-keyed state model. All providers emit unified events on the shared `ai:message` IPC channel. Frontend provider wrappers implement the existing `Provider` interface.

**Tech Stack:** Electron IPC, child_process spawn, JSON-RPC 2.0 (Gemini ACP), Vitest, Lucide React, CSS modules

---

## File Structure

### New Files
- `electron/services/gemini-acp.ts` — JSON-RPC 2.0 transport client for `gemini --acp`
- `electron/services/codex.ts` — Codex subprocess management + event translation
- `electron/services/gemini.ts` — Gemini ACP session management + event translation
- `src/providers/codex.ts` — Frontend Codex provider (implements `Provider`)
- `src/providers/gemini.ts` — Frontend Gemini provider (implements `Provider`)
- `public/svg/claude.svg` — Claude brand icon
- `public/svg/openai.svg` — OpenAI brand icon (for Codex)
- `public/svg/Google-gemini-icon.svg` — Gemini brand icon
- `tests/unit/codexTranslate.test.ts` — Codex event translation tests
- `tests/unit/geminiTranslate.test.ts` — Gemini event translation tests

### Modified Files
- `src/types.ts` — Add `AIProvider` type, extend `TabState`
- `electron/preload.ts` — Add `codex` and `gemini` IPC namespaces
- `electron/main.ts` — Register new services
- `src/providers/claude.ts` — Add `approve` method delegation
- `src/components/TerminalSession.tsx` — Dynamic provider creation, provider-aware approval
- `src/components/TerminalInput.tsx` — Permission badge, new props
- `src/components/TerminalInput.module.css` — Permission badge styles
- `src/App.tsx` — Add `aiProvider` to tab state, prop threading
- `src/components/QuickSettings.tsx` — Provider selector dropdown
- `src/components/SettingsOverlay.tsx` — Provider dropdown in AI section

---

### Task 1: Types & SVG Assets

**Files:**
- Modify: `src/types.ts`
- Create: `public/svg/claude.svg`
- Create: `public/svg/openai.svg`
- Create: `public/svg/Google-gemini-icon.svg`

- [ ] **Step 1: Add AIProvider type and extend TabState**

In `src/types.ts`, add the `AIProvider` type and extend `TabState`:

```typescript
// Add after TrustLevel definition (line 2)
export type AIProvider = 'claude' | 'codex' | 'gemini';
```

```typescript
// In TabState interface, add after remoteExecMode (line 52):
aiProvider: AIProvider;
```

- [ ] **Step 2: Update createTabState default in App.tsx**

In `src/App.tsx`, add `aiProvider: 'claude'` to the `createTabState` function:

```typescript
function createTabState(): TabState {
  const id = `tab-${++tabCounter}`;
  return { id, ptyId: null, label: 'zsh', cwd: '', contextMode: 'shell', trustLevel: 'ask', isRemote: false, sshTarget: null, remoteExecMode: 'auto' as const, aiProvider: 'claude' as const };
}
```

- [ ] **Step 3: Create SVG icon files**

Create `public/svg/claude.svg`:
```svg
<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="#D4A27F" class="bi bi-claude" viewBox="0 0 16 16">
  <path d="m3.127 10.604 3.135-1.76.053-.153-.053-.085H6.11l-.525-.032-1.791-.048-1.554-.065-1.505-.08-.38-.081L0 7.832l.036-.234.32-.214.455.04 1.009.069 1.513.105 1.097.064 1.626.17h.259l.036-.105-.089-.065-.068-.064-1.566-1.062-1.695-1.121-.887-.646-.48-.327-.243-.306-.104-.67.435-.48.585.04.15.04.593.456 1.267.981 1.654 1.218.242.202.097-.068.012-.049-.109-.181-.9-1.626-.96-1.655-.428-.686-.113-.411a2 2 0 0 1-.068-.484l.496-.674L4.446 0l.662.089.279.242.411.94.666 1.48 1.033 2.014.302.597.162.553.06.17h.105v-.097l.085-1.134.157-1.392.154-1.792.052-.504.25-.605.497-.327.387.186.319.456-.045.294-.19 1.23-.37 1.93-.243 1.29h.142l.161-.16.654-.868 1.097-1.372.484-.545.565-.601.363-.287h.686l.505.751-.226.775-.707.895-.585.759-.839 1.13-.524.904.048.072.125-.012 1.897-.403 1.024-.186 1.223-.21.553.258.06.263-.218.536-1.307.323-1.533.307-2.284.54-.028.02.032.04 1.029.098.44.024h1.077l2.005.15.525.346.315.424-.053.323-.807.411-3.631-.863-.872-.218h-.12v.073l.726.71 1.331 1.202 1.667 1.55.084.383-.214.302-.226-.032-1.464-1.101-.565-.497-1.28-1.077h-.084v.113l.295.432 1.557 2.34.08.718-.112.234-.404.141-.444-.08-.911-1.28-.94-1.44-.759-1.291-.093.053-.448 4.821-.21.246-.484.186-.403-.307-.214-.496.214-.98.258-1.28.21-1.016.19-1.263.112-.42-.008-.028-.092.012-.953 1.307-1.448 1.957-1.146 1.227-.274.109-.477-.247.045-.44.266-.39 1.586-2.018.956-1.25.617-.723-.004-.105h-.036l-4.212 2.736-.75.096-.324-.302.04-.496.154-.162 1.267-.871z"/>
</svg>
```

Create `public/svg/openai.svg`:
```svg
<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="#FFFFFF" class="bi bi-openai" viewBox="0 0 16 16">
  <path d="M14.949 6.547a3.94 3.94 0 0 0-.348-3.273 4.11 4.11 0 0 0-4.4-1.934A4.1 4.1 0 0 0 8.423.2 4.15 4.15 0 0 0 6.305.086a4.1 4.1 0 0 0-1.891.948 4.04 4.04 0 0 0-1.158 1.753 4.1 4.1 0 0 0-1.563.679A4 4 0 0 0 .554 4.72a3.99 3.99 0 0 0 .502 4.731 3.94 3.94 0 0 0 .346 3.274 4.11 4.11 0 0 0 4.402 1.933c.382.425.852.764 1.377.995.526.231 1.095.35 1.67.346 1.78.002 3.358-1.132 3.901-2.804a4.1 4.1 0 0 0 1.563-.68 4 4 0 0 0 1.14-1.253 3.99 3.99 0 0 0-.506-4.716m-6.097 8.406a3.05 3.05 0 0 1-1.945-.694l.096-.054 3.23-1.838a.53.53 0 0 0 .265-.455v-4.49l1.366.778q.02.011.025.035v3.722c-.003 1.653-1.361 2.992-3.037 2.996m-6.53-2.75a2.95 2.95 0 0 1-.36-2.01l.095.057L5.29 12.09a.53.53 0 0 0 .527 0l3.949-2.246v1.555a.05.05 0 0 1-.022.041L6.473 13.3c-1.454.826-3.311.335-4.15-1.098m-.85-6.94A3.02 3.02 0 0 1 3.07 3.949v3.785a.51.51 0 0 0 .262.451l3.93 2.237-1.366.779a.05.05 0 0 1-.048 0L2.585 9.342a2.98 2.98 0 0 1-1.113-4.094zm11.216 2.571L8.747 5.576l1.362-.776a.05.05 0 0 1 .048 0l3.265 1.86a3 3 0 0 1 1.173 1.207 2.96 2.96 0 0 1-.27 3.2 3.05 3.05 0 0 1-1.36.997V8.279a.52.52 0 0 0-.276-.445m1.36-2.015-.097-.057-3.226-1.855a.53.53 0 0 0-.53 0L6.249 6.153V4.598a.04.04 0 0 1 .019-.04L9.533 2.7a3.07 3.07 0 0 1 3.257.139c.474.325.843.778 1.066 1.303.223.526.289 1.103.191 1.664zM5.503 8.575 4.139 7.8a.05.05 0 0 1-.026-.037V4.049c0-.57.166-1.127.476-1.607s.752-.864 1.275-1.105a3.08 3.08 0 0 1 3.234.41l-.096.054-3.23 1.838a.53.53 0 0 0-.265.455zm.742-1.577 1.758-1 1.762 1v2l-1.755 1-1.762-1z"/>
</svg>
```

Create `public/svg/Google-gemini-icon.svg`:
```svg
<svg fill="none" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M16 8.016A8.522 8.522 0 008.016 16h-.032A8.521 8.521 0 000 8.016v-.032A8.521 8.521 0 007.984 0h.032A8.522 8.522 0 0016 7.984v.032z" fill="url(#prefix__paint0_radial_980_20147)"/><defs><radialGradient id="prefix__paint0_radial_980_20147" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="matrix(16.1326 5.4553 -43.70045 129.2322 1.588 6.503)"><stop offset=".067" stop-color="#9168C0"/><stop offset=".343" stop-color="#5684D1"/><stop offset=".672" stop-color="#1BA1E3"/></radialGradient></defs></svg>
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd /var/home/mstephens/Documents/GitHub/tai && npx tsc --noEmit 2>&1 | head -20`

Expected: No errors related to `AIProvider` or `TabState`.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/App.tsx public/svg/claude.svg public/svg/openai.svg public/svg/Google-gemini-icon.svg
git commit -m "feat: add AIProvider type, extend TabState, add provider SVG icons"
```

---

### Task 2: Gemini ACP Transport Client

**Files:**
- Create: `electron/services/gemini-acp.ts`

- [ ] **Step 1: Create gemini-acp.ts**

Create `electron/services/gemini-acp.ts` — a direct port from SAI with `'tai'` as client name:

```typescript
import { spawn, ChildProcess } from 'node:child_process';

export interface GeminiAcpClientOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  clientInfo?: {
    name: string;
    version: string;
  };
}

export interface GeminiAcpClient {
  start(): Promise<void>;
  request<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
  notify(method: string, params?: Record<string, unknown>): void;
  onEvent(listener: (event: unknown) => void): () => void;
  dispose(): void;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

export function createGeminiAcpClient(options: GeminiAcpClientOptions): GeminiAcpClient {
  const clientInfo = options.clientInfo ?? { name: 'tai', version: '1.0' };
  let processHandle: ChildProcess | null = null;
  let nextId = 0;
  let stdoutBuffer = '';
  let startPromise: Promise<void> | null = null;
  let startResolve: (() => void) | null = null;
  let startReject: ((error: Error) => void) | null = null;
  let started = false;
  const pending = new Map<number, PendingRequest>();
  const eventListeners = new Set<(event: unknown) => void>();

  function rejectAllPending(error: Error) {
    for (const entry of pending.values()) {
      entry.reject(error);
    }
    pending.clear();

    if (startReject) {
      startReject(error);
      startReject = null;
      startResolve = null;
      startPromise = null;
    }
  }

  function writeMessage(message: unknown) {
    if (!processHandle?.stdin) {
      throw new Error('Gemini ACP transport not started');
    }
    processHandle.stdin.write(JSON.stringify(message) + '\n');
  }

  function handleMessage(message: any) {
    if (typeof message?.id === 'number') {
      if (message.id === 0 && startResolve) {
        if (message.error) {
          const error = new Error(message.error.message || 'Gemini ACP initialize failed');
          startReject?.(error);
        } else {
          started = true;
          startResolve();
        }
        startResolve = null;
        startReject = null;
      }

      const pendingRequest = pending.get(message.id);
      if (!pendingRequest) return;

      pending.delete(message.id);
      if (message.error) {
        pendingRequest.reject(new Error(message.error.message || 'Gemini ACP request failed'));
      } else {
        pendingRequest.resolve(message.result);
      }
      return;
    }

    eventListeners.forEach(listener => listener(message));
  }

  function ensureStarted() {
    if (!started || !processHandle) {
      throw new Error('Gemini ACP transport not started');
    }
  }

  return {
    start() {
      if (startPromise) return startPromise;
      if (started) return Promise.resolve();

      startPromise = new Promise<void>((resolve, reject) => {
        startResolve = resolve;
        startReject = reject;
      });

      const proc = spawn('gemini', ['--acp'], {
        cwd: options.cwd,
        env: options.env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      processHandle = proc;

      proc.stdout?.on('data', (chunk: Buffer) => {
        stdoutBuffer += chunk.toString();
        const lines = stdoutBuffer.split('\n');
        stdoutBuffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            handleMessage(JSON.parse(line));
          } catch {
            // Ignore malformed transport lines.
          }
        }
      });

      proc.on('error', (error) => {
        processHandle = null;
        started = false;
        rejectAllPending(new Error(`Gemini ACP transport error: ${error.message}`));
      });

      proc.on('exit', () => {
        processHandle = null;
        started = false;
        rejectAllPending(new Error('Gemini ACP transport exited'));
      });

      writeMessage({
        jsonrpc: '2.0',
        id: nextId++,
        method: 'initialize',
        params: {
          protocolVersion: 1,
          clientInfo,
        },
      });

      return startPromise;
    },

    request<T = unknown>(method: string, params: Record<string, unknown> = {}) {
      ensureStarted();
      const id = nextId++;
      return new Promise<T>((resolve, reject) => {
        pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
        writeMessage({
          jsonrpc: '2.0',
          id,
          method,
          params,
        });
      });
    },

    notify(method: string, params: Record<string, unknown> = {}) {
      ensureStarted();
      writeMessage({
        jsonrpc: '2.0',
        method,
        params,
      });
    },

    onEvent(listener: (event: unknown) => void) {
      eventListeners.add(listener);
      return () => {
        eventListeners.delete(listener);
      };
    },

    dispose() {
      if (processHandle) {
        processHandle.kill();
        processHandle = null;
      }
      started = false;
    },
  };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /var/home/mstephens/Documents/GitHub/tai && npx tsc --noEmit 2>&1 | head -20`

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add electron/services/gemini-acp.ts
git commit -m "feat: add Gemini ACP JSON-RPC 2.0 transport client"
```

---

### Task 3: Codex Event Translation & Tests

**Files:**
- Create: `tests/unit/codexTranslate.test.ts`
- Create: `electron/services/codex.ts` (partial — just `translateEvent` and `enrichedEnv`)

- [ ] **Step 1: Write failing tests for Codex event translation**

Create `tests/unit/codexTranslate.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { translateCodexEvent } from '../../electron/services/codex';

describe('translateCodexEvent', () => {
  const projectPath = '/tmp/test-project';

  it('translates thread.started to session_id', () => {
    const events = translateCodexEvent(
      { type: 'thread.started', thread_id: 'thread-123' },
      projectPath,
    );
    expect(events).toEqual([
      { type: 'session_id', sessionId: 'thread-123', projectPath },
    ]);
  });

  it('translates item.started command_execution to tool_use Bash', () => {
    const events = translateCodexEvent(
      { type: 'item.started', item: { type: 'command_execution', id: 'tool-1', command: 'ls -la' } },
      projectPath,
    );
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('assistant');
    expect(events[0].message.content[0]).toMatchObject({
      id: 'tool-1',
      type: 'tool_use',
      name: 'Bash',
      input: { command: 'ls -la' },
    });
  });

  it('translates item.started file_change to tool_use Edit', () => {
    const events = translateCodexEvent(
      { type: 'item.started', item: { type: 'file_change', id: 'tool-2', file_path: '/tmp/foo.ts' } },
      projectPath,
    );
    expect(events).toHaveLength(1);
    expect(events[0].message.content[0]).toMatchObject({
      id: 'tool-2',
      type: 'tool_use',
      name: 'Edit',
      input: { file_path: '/tmp/foo.ts' },
    });
  });

  it('translates item.completed agent_message to text', () => {
    const events = translateCodexEvent(
      { type: 'item.completed', item: { type: 'agent_message', text: 'Hello world' } },
      projectPath,
    );
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('assistant');
    expect(events[0].message.content[0]).toMatchObject({ type: 'text', text: 'Hello world' });
  });

  it('translates item.completed command_execution to tool_result', () => {
    const events = translateCodexEvent(
      { type: 'item.completed', item: { type: 'command_execution', id: 'tool-1', aggregated_output: 'file.txt', exit_code: 0 } },
      projectPath,
    );
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('user');
    expect(events[0].message.content[0]).toMatchObject({
      type: 'tool_result',
      tool_use_id: 'tool-1',
      content: 'file.txt',
      is_error: false,
    });
  });

  it('marks failed command_execution as error', () => {
    const events = translateCodexEvent(
      { type: 'item.completed', item: { type: 'command_execution', id: 'tool-1', aggregated_output: 'err', exit_code: 1 } },
      projectPath,
    );
    expect(events[0].message.content[0].is_error).toBe(true);
  });

  it('translates turn.completed to result + done', () => {
    const events = translateCodexEvent(
      { type: 'turn.completed', usage: { input_tokens: 100, output_tokens: 50, cached_input_tokens: 10 } },
      projectPath,
    );
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe('result');
    expect(events[0].usage.input_tokens).toBe(100);
    expect(events[1].type).toBe('done');
  });

  it('translates turn.failed to error + done', () => {
    const events = translateCodexEvent(
      { type: 'turn.failed', message: 'Rate limited' },
      projectPath,
    );
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe('error');
    expect(events[0].text).toBe('Rate limited');
    expect(events[1].type).toBe('done');
  });

  it('returns empty array for unknown event types', () => {
    expect(translateCodexEvent({ type: 'unknown_thing' }, projectPath)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /var/home/mstephens/Documents/GitHub/tai && npx vitest run tests/unit/codexTranslate.test.ts 2>&1 | tail -10`

Expected: FAIL — cannot resolve `../../electron/services/codex`.

- [ ] **Step 3: Implement codex.ts with translateCodexEvent exported**

Create `electron/services/codex.ts`:

```typescript
import { spawn, ChildProcess } from 'node:child_process';
import { ipcMain, BrowserWindow } from 'electron';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

function enrichedEnv(): Record<string, string> {
  const env = { ...process.env } as Record<string, string>;
  const home = os.homedir();
  const extraPaths: string[] = [];

  const nvmDir = path.join(home, '.nvm', 'versions', 'node');
  if (fs.existsSync(nvmDir)) {
    try {
      const versions = fs.readdirSync(nvmDir);
      for (const v of versions) {
        extraPaths.push(path.join(nvmDir, v, 'bin'));
      }
    } catch { /* ignore */ }
  }

  extraPaths.push(
    path.join(home, '.local', 'bin'),
    path.join(home, '.volta', 'bin'),
    '/usr/local/bin',
    '/opt/homebrew/bin',
  );

  const currentPath = env.PATH || '';
  const pathSet = new Set(currentPath.split(':'));
  const additions = extraPaths.filter(p => !pathSet.has(p));
  if (additions.length > 0) {
    env.PATH = currentPath + ':' + additions.join(':');
  }
  return env;
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
      args.push('exec', 'resume', '--json', state.sessionId);
    } else {
      args.push('exec', '--json');
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

    const proc = spawn('codex', args, {
      cwd,
      env: enrichedEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

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
      if (text) {
        safeSend(win, 'ai:error', key, text);
      }
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /var/home/mstephens/Documents/GitHub/tai && npx vitest run tests/unit/codexTranslate.test.ts 2>&1 | tail -15`

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/services/codex.ts tests/unit/codexTranslate.test.ts
git commit -m "feat: add Codex service with event translation and tests"
```

---

### Task 4: Gemini Event Translation & Tests

**Files:**
- Create: `tests/unit/geminiTranslate.test.ts`
- Create: `electron/services/gemini.ts`

- [ ] **Step 1: Write failing tests for Gemini event translation**

Create `tests/unit/geminiTranslate.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { translateGeminiEvent } from '../../electron/services/gemini';

describe('translateGeminiEvent', () => {
  const projectPath = '/tmp/test-project';

  it('translates session/update agent_message_chunk to delta text', () => {
    const result = translateGeminiEvent({
      method: 'session/update',
      params: { update: { sessionUpdate: 'agent_message_chunk', content: { text: 'Hello' } } },
    }, projectPath);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('assistant');
    expect(result!.message.content[0]).toMatchObject({ type: 'text', text: 'Hello', delta: true });
  });

  it('translates session/update tool_call to tool_use', () => {
    const result = translateGeminiEvent({
      method: 'session/update',
      params: { update: { sessionUpdate: 'tool_call', toolCallId: 'tc-1', title: 'ReadFile', kind: 'read', locations: ['/tmp/foo'] } },
    }, projectPath);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('assistant');
    expect(result!.message.content[0]).toMatchObject({
      id: 'tc-1',
      type: 'tool_use',
      name: 'ReadFile',
    });
  });

  it('translates session/update tool_call_update to tool_result', () => {
    const result = translateGeminiEvent({
      method: 'session/update',
      params: { update: { sessionUpdate: 'tool_call_update', toolCallId: 'tc-1', content: [{ type: 'content', content: { type: 'text', text: 'file contents' } }], status: 'completed' } },
    }, projectPath);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('user');
    expect(result!.message.content[0]).toMatchObject({
      type: 'tool_result',
      tool_use_id: 'tc-1',
      is_error: false,
    });
  });

  it('marks failed tool_call_update as error', () => {
    const result = translateGeminiEvent({
      method: 'session/update',
      params: { update: { sessionUpdate: 'tool_call_update', toolCallId: 'tc-1', content: [], status: 'failed' } },
    }, projectPath);
    expect(result!.message.content[0].is_error).toBe(true);
  });

  it('translates tool/call to tool_use', () => {
    const result = translateGeminiEvent({
      method: 'tool/call',
      params: { id: 'tc-2', name: 'Bash', input: { command: 'ls' } },
    }, projectPath);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('assistant');
    expect(result!.message.content[0]).toMatchObject({
      id: 'tc-2',
      type: 'tool_use',
      name: 'Bash',
      input: { command: 'ls' },
    });
  });

  it('translates tool/result to tool_result', () => {
    const result = translateGeminiEvent({
      method: 'tool/result',
      params: { id: 'tc-2', output: 'file.txt', isError: false },
    }, projectPath);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('user');
    expect(result!.message.content[0]).toMatchObject({
      type: 'tool_result',
      tool_use_id: 'tc-2',
      content: 'file.txt',
      is_error: false,
    });
  });

  it('translates message/assistant to text', () => {
    const result = translateGeminiEvent({
      method: 'message/assistant',
      params: { text: 'Here is the answer', delta: false },
    }, projectPath);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('assistant');
    expect(result!.message.content[0]).toMatchObject({ type: 'text', text: 'Here is the answer', delta: false });
  });

  it('returns null for unknown event methods', () => {
    expect(translateGeminiEvent({ method: 'unknown/event' }, projectPath)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /var/home/mstephens/Documents/GitHub/tai && npx vitest run tests/unit/geminiTranslate.test.ts 2>&1 | tail -10`

Expected: FAIL — cannot resolve `../../electron/services/gemini`.

- [ ] **Step 3: Implement gemini.ts**

Create `electron/services/gemini.ts`:

```typescript
import { BrowserWindow, ipcMain } from 'electron';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { createGeminiAcpClient } from './gemini-acp';
import type { GeminiAcpClient } from './gemini-acp';

function enrichedEnv(): Record<string, string> {
  const env = { ...process.env } as Record<string, string>;
  const home = os.homedir();
  const extraPaths: string[] = [];
  const nvmDir = path.join(home, '.nvm', 'versions', 'node');

  if (fs.existsSync(nvmDir)) {
    try {
      const versions = fs.readdirSync(nvmDir);
      for (const v of versions) {
        extraPaths.push(path.join(nvmDir, v, 'bin'));
      }
    } catch { /* ignore */ }
  }

  extraPaths.push(
    path.join(home, '.local', 'bin'),
    path.join(home, '.volta', 'bin'),
    '/usr/local/bin',
    '/opt/homebrew/bin',
  );

  const currentPath = env.PATH || '';
  const pathSet = new Set(currentPath.split(':'));
  const additions = extraPaths.filter(p => !pathSet.has(p));
  if (additions.length > 0) {
    env.PATH = currentPath + ':' + additions.join(':');
  }
  return env;
}

function safeSend(win: BrowserWindow | null, channel: string, ...args: unknown[]) {
  try {
    if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
  } catch { /* window destroyed */ }
}

const BOOTSTRAP_FILES = ['README.md', 'package.json', 'GEMINI.md', 'CLAUDE.md', 'tsconfig.json'];

function readFileSnippet(filePath: string, maxChars: number): string | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, 'utf8').slice(0, maxChars).trim();
  } catch {
    return null;
  }
}

function collectProjectPaths(rootPath: string, maxEntries: number, maxDepth: number): string[] {
  const results: string[] = [];

  function visit(currentPath: string, depth: number) {
    if (results.length >= maxEntries || depth > maxDepth) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentPath, { withFileTypes: true });
    } catch { return; }

    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (results.length >= maxEntries) return;
      if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'dist-electron') continue;
      const absolutePath = path.join(currentPath, entry.name);
      const relativePath = path.relative(rootPath, absolutePath) || '.';
      results.push(entry.isDirectory() ? `${relativePath}/` : relativePath);
      if (entry.isDirectory()) visit(absolutePath, depth + 1);
    }
  }

  visit(rootPath, 0);
  return results;
}

function buildProjectBootstrap(rootPath: string): string {
  const topLevel = (() => {
    try {
      return fs.readdirSync(rootPath).sort().slice(0, 40).join('\n');
    } catch { return ''; }
  })();

  const projectPaths = collectProjectPaths(rootPath, 120, 2).join('\n');
  const fileSnippets = BOOTSTRAP_FILES
    .map((name) => {
      const snippet = readFileSnippet(path.join(rootPath, name), 2000);
      if (!snippet) return null;
      return `## ${name}\n${snippet}`;
    })
    .filter(Boolean)
    .join('\n\n');

  return [
    'Project bootstrap context for this repository.',
    'Use it as orientation for future edits and suggestions.',
    'Do not answer this message or summarize it back.',
    '',
    `Repository root: ${rootPath}`,
    '',
    topLevel ? `Top-level entries:\n${topLevel}` : '',
    projectPaths ? `Shallow project map:\n${projectPaths}` : '',
    fileSnippets ? `Key file snippets:\n${fileSnippets}` : '',
  ].filter(Boolean).join('\n');
}

function renderToolContent(content: any[] | undefined): string {
  if (!Array.isArray(content) || content.length === 0) return '';
  return content.map((item) => {
    if (item?.type === 'content' && item.content?.type === 'text') return item.content.text || '';
    if (item?.type === 'diff') return JSON.stringify(item);
    return JSON.stringify(item);
  }).filter(Boolean).join('\n');
}

export function translateGeminiEvent(msg: any, projectPath: string): any | null {
  if (msg?.method === 'session/update') {
    const update = msg.params?.update;
    if (update?.sessionUpdate === 'agent_message_chunk') {
      return {
        type: 'assistant',
        projectPath,
        message: {
          content: [{
            type: 'text',
            text: update.content?.text || '',
            delta: true,
          }],
        },
      };
    }

    if (update?.sessionUpdate === 'tool_call') {
      return {
        type: 'assistant',
        projectPath,
        message: {
          content: [{
            id: update.toolCallId,
            type: 'tool_use',
            name: update.title || 'tool',
            input: { kind: update.kind, locations: update.locations },
          }],
        },
      };
    }

    if (update?.sessionUpdate === 'tool_call_update') {
      return {
        type: 'user',
        projectPath,
        message: {
          content: [{
            type: 'tool_result',
            tool_use_id: update.toolCallId,
            content: renderToolContent(update.content),
            is_error: update.status === 'failed',
          }],
        },
      };
    }

    return null;
  }

  if (msg?.method === 'message/assistant') {
    return {
      type: 'assistant',
      projectPath,
      message: {
        content: [{
          type: 'text',
          text: msg.params?.text || '',
          delta: !!msg.params?.delta,
        }],
      },
    };
  }

  if (msg?.method === 'tool/call') {
    return {
      type: 'assistant',
      projectPath,
      message: {
        content: [{
          id: msg.params?.id,
          type: 'tool_use',
          name: msg.params?.name || 'tool',
          input: msg.params?.input || {},
        }],
      },
    };
  }

  if (msg?.method === 'tool/result') {
    return {
      type: 'user',
      projectPath,
      message: {
        content: [{
          type: 'tool_result',
          tool_use_id: msg.params?.id,
          content: msg.params?.output || '',
          is_error: !!msg.params?.isError,
        }],
      },
    };
  }

  return null;
}

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

const geminiStates = new Map<string, GeminiState>();

function getState(key: string): GeminiState {
  let state = geminiStates.get(key);
  if (!state) {
    state = {
      transport: null,
      sessionId: null,
      cwd: '',
      busy: false,
      availability: 'available',
      lastError: undefined,
      pendingApproval: null,
      bootstrapped: false,
    };
    geminiStates.set(key, state);
  }
  return state;
}

function disableGemini(win: BrowserWindow | null, key: string, state: GeminiState, reason: string) {
  state.transport?.dispose();
  state.transport = null;
  state.sessionId = null;
  state.availability = 'disabled';
  state.lastError = reason;
  state.busy = false;
  state.pendingApproval = null;
  state.bootstrapped = false;
  safeSend(win, 'ai:message', key, { type: 'error', text: `Gemini unavailable: ${reason}` });
  safeSend(win, 'ai:message', key, { type: 'done' });
}

async function ensureTransport(win: BrowserWindow | null, key: string, state: GeminiState): Promise<GeminiAcpClient> {
  if (state.transport) return state.transport;

  const client = createGeminiAcpClient({
    cwd: state.cwd,
    env: enrichedEnv(),
    clientInfo: { name: 'tai', version: '1.0' },
  });

  client.onEvent((event: any) => {
    if (event?.method === 'tool.approvalRequired' || event?.method === 'tool/approvalRequired') {
      const input = event.params?.input || {};
      state.pendingApproval = {
        toolUseId: event.params?.id || '',
        toolName: event.params?.name || 'tool',
        input,
      };
      safeSend(win, 'ai:message', key, {
        type: 'approval_needed',
        toolUseId: event.params?.id || '',
        toolName: event.params?.name || 'tool',
        command: input.command || input.file_path || JSON.stringify(input),
        description: event.params?.description || '',
        input,
      });
      return;
    }

    const translated = translateGeminiEvent(event, state.cwd);
    if (translated) {
      safeSend(win, 'ai:message', key, translated);
    }
  });

  await client.start();
  state.transport = client;
  state.availability = 'available';
  state.lastError = undefined;
  return client;
}

async function ensureSession(win: BrowserWindow | null, key: string, state: GeminiState): Promise<string> {
  const client = await ensureTransport(win, key, state);

  if (state.sessionId) return state.sessionId;

  const result = await client.request<{ sessionId: string }>('session/new', {
    cwd: state.cwd,
    mcpServers: [],
  });
  state.sessionId = result.sessionId;
  safeSend(win, 'ai:message', key, { type: 'session_id', sessionId: result.sessionId });
  return result.sessionId;
}

export function setupGeminiService(getWindow: () => BrowserWindow | null) {
  ipcMain.handle('gemini:send', async (_event, key: string, cwd: string, message: string, approvalMode: string, model: string) => {
    const win = getWindow();
    const state = getState(key);
    state.cwd = cwd;

    if (state.availability === 'disabled') {
      safeSend(win, 'ai:message', key, { type: 'error', text: `Gemini unavailable: ${state.lastError || 'retry to continue'}` });
      safeSend(win, 'ai:message', key, { type: 'done' });
      return false;
    }

    try {
      const client = await ensureTransport(win, key, state);
      const sessionId = await ensureSession(win, key, state);
      const bootstrapText = state.bootstrapped ? undefined : buildProjectBootstrap(cwd);

      state.busy = true;
      safeSend(win, 'ai:message', key, { type: 'streaming_start' });

      const prompt: Array<Record<string, unknown>> = [];
      if (bootstrapText) {
        prompt.push({ type: 'text', text: bootstrapText });
      }
      prompt.push({ type: 'text', text: message });

      const result = await client.request<any>('session/prompt', {
        sessionId,
        prompt,
        approvalMode: approvalMode || 'auto_edit',
        model: model || undefined,
      });

      if (bootstrapText) state.bootstrapped = true;

      state.busy = false;
      safeSend(win, 'ai:message', key, {
        type: 'result',
        usage: {
          input_tokens: result?.usage?.input_tokens || 0,
          cache_read_input_tokens: result?.usage?.cached || 0,
          cache_creation_input_tokens: 0,
          output_tokens: result?.usage?.output_tokens || 0,
        },
      });
      safeSend(win, 'ai:message', key, { type: 'done' });
      return true;
    } catch (error) {
      disableGemini(win, key, state, error instanceof Error ? error.message : 'Gemini request failed');
      return false;
    }
  });

  ipcMain.on('gemini:stop', async (_event, key: string) => {
    const state = getState(key);
    if (state.transport && state.sessionId && state.busy) {
      try {
        await state.transport.request('session/cancel', { sessionId: state.sessionId });
      } catch { /* ignore cancellation failures */ }
    }
    state.busy = false;
    safeSend(getWindow(), 'ai:message', key, { type: 'done' });
  });

  ipcMain.handle('gemini:approve', async (_event, key: string, toolUseId: string, approved: boolean) => {
    const state = getState(key);
    if (!state.transport || !state.pendingApproval) return false;

    try {
      await state.transport.request('tool/approve', {
        id: toolUseId,
        approved,
      });
      state.pendingApproval = null;
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.on('gemini:setSessionId', (_event, key: string, sessionId: string | undefined) => {
    const state = getState(key);
    state.sessionId = sessionId || null;
    state.bootstrapped = false;
  });
}

export function destroyAllGemini() {
  for (const state of geminiStates.values()) {
    state.transport?.dispose();
  }
  geminiStates.clear();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /var/home/mstephens/Documents/GitHub/tai && npx vitest run tests/unit/geminiTranslate.test.ts 2>&1 | tail -15`

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/services/gemini.ts tests/unit/geminiTranslate.test.ts
git commit -m "feat: add Gemini service with ACP integration, event translation, and tests"
```

---

### Task 5: Register Backend Services in Main Process

**Files:**
- Modify: `electron/main.ts:1-6` (imports), `electron/main.ts:84-89` (registration), `electron/main.ts:91-94` (cleanup)

- [ ] **Step 1: Add imports to main.ts**

Add after line 3 (`import { setupClaudeService, destroyAllClaude } from './services/claude';`):

```typescript
import { setupCodexService, destroyAllCodex } from './services/codex';
import { setupGeminiService, destroyAllGemini } from './services/gemini';
```

- [ ] **Step 2: Register services in app.whenReady()**

After `setupClaudeService(() => mainWindow);` (line 88), add:

```typescript
  setupCodexService(() => mainWindow);
  setupGeminiService(() => mainWindow);
```

- [ ] **Step 3: Add cleanup in before-quit**

After `destroyAllClaude();` (line 93), add:

```typescript
  destroyAllCodex();
  destroyAllGemini();
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd /var/home/mstephens/Documents/GitHub/tai && npx tsc --noEmit 2>&1 | head -20`

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add electron/main.ts
git commit -m "feat: register Codex and Gemini services in main process"
```

---

### Task 6: Extend Preload IPC Bridge

**Files:**
- Modify: `electron/preload.ts:26-49` (add codex/gemini namespaces inside `window.tai`)

- [ ] **Step 1: Add codex and gemini namespaces to preload.ts**

After the `ai` namespace (after line 48), add the `codex` and `gemini` namespaces:

```typescript
  codex: {
    send: (key: string, cwd: string, message: string, permMode: string, model: string) =>
      ipcRenderer.invoke('codex:send', key, cwd, message, permMode, model),
    stop: (key: string) => ipcRenderer.send('codex:stop', key),
    setSessionId: (key: string, sessionId: string | undefined) =>
      ipcRenderer.send('codex:setSessionId', key, sessionId),
  },
  gemini: {
    send: (key: string, cwd: string, message: string, approvalMode: string, model: string) =>
      ipcRenderer.invoke('gemini:send', key, cwd, message, approvalMode, model),
    stop: (key: string) => ipcRenderer.send('gemini:stop', key),
    approve: (key: string, toolUseId: string, approved: boolean) =>
      ipcRenderer.invoke('gemini:approve', key, toolUseId, approved),
    setSessionId: (key: string, sessionId: string | undefined) =>
      ipcRenderer.send('gemini:setSessionId', key, sessionId),
  },
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /var/home/mstephens/Documents/GitHub/tai && npx tsc --noEmit 2>&1 | head -20`

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add electron/preload.ts
git commit -m "feat: add Codex and Gemini IPC namespaces to preload bridge"
```

---

### Task 7: Frontend Provider Wrappers

**Files:**
- Create: `src/providers/codex.ts`
- Create: `src/providers/gemini.ts`

- [ ] **Step 1: Create Codex frontend provider**

Create `src/providers/codex.ts`:

```typescript
import type { Provider, ProviderCapabilities } from './types';
import type { TrustLevel } from '@/types';

const TRUST_TO_PERM: Record<TrustLevel, string> = {
  'ask': 'auto',
  'approve-edits': 'read-only',
  'bypass': 'full-access',
};

export function createCodexProvider(tabId: string): Provider {
  let messageCleanup: (() => void) | null = null;

  return {
    id: 'codex',
    name: 'Codex',

    send(message: string, cwd: string, trustLevel: string, model?: string) {
      const permMode = TRUST_TO_PERM[trustLevel as TrustLevel] || 'auto';
      window.tai.codex.send(tabId, cwd, message, permMode, model || '');
    },

    cancel() {
      window.tai.codex.stop(tabId);
    },

    stop() {
      window.tai.codex.stop(tabId);
    },

    onMessage(callback: (msg: any) => void): () => void {
      messageCleanup?.();
      const thisCleanup = window.tai.ai.onMessage(tabId, callback);
      messageCleanup = thisCleanup;
      return () => {
        thisCleanup();
        if (messageCleanup === thisCleanup) messageCleanup = null;
      };
    },

    getCapabilities(): ProviderCapabilities {
      return {
        streaming: true,
        toolUse: true,
        fileEdit: true,
        commandExecution: true,
      };
    },
  };
}
```

- [ ] **Step 2: Create Gemini frontend provider**

Create `src/providers/gemini.ts`:

```typescript
import type { Provider, ProviderCapabilities } from './types';
import type { TrustLevel } from '@/types';

const TRUST_TO_APPROVAL: Record<TrustLevel, string> = {
  'ask': 'default',
  'approve-edits': 'auto_edit',
  'bypass': 'yolo',
};

export function createGeminiProvider(tabId: string): Provider {
  let messageCleanup: (() => void) | null = null;

  return {
    id: 'gemini',
    name: 'Gemini',

    send(message: string, cwd: string, trustLevel: string, model?: string) {
      const approvalMode = TRUST_TO_APPROVAL[trustLevel as TrustLevel] || 'default';
      window.tai.gemini.send(tabId, cwd, message, approvalMode, model || '');
    },

    cancel() {
      window.tai.gemini.stop(tabId);
    },

    stop() {
      window.tai.gemini.stop(tabId);
    },

    onMessage(callback: (msg: any) => void): () => void {
      messageCleanup?.();
      const thisCleanup = window.tai.ai.onMessage(tabId, callback);
      messageCleanup = thisCleanup;
      return () => {
        thisCleanup();
        if (messageCleanup === thisCleanup) messageCleanup = null;
      };
    },

    getCapabilities(): ProviderCapabilities {
      return {
        streaming: true,
        toolUse: true,
        fileEdit: true,
        commandExecution: true,
      };
    },
  };
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd /var/home/mstephens/Documents/GitHub/tai && npx tsc --noEmit 2>&1 | head -20`

Expected: No errors (may have type errors for `window.tai.codex` / `window.tai.gemini` — these are accessed via the preload bridge and are typed at runtime; if TS errors appear, add declarations to a `src/global.d.ts` or use `(window as any).tai`).

- [ ] **Step 4: Commit**

```bash
git add src/providers/codex.ts src/providers/gemini.ts
git commit -m "feat: add Codex and Gemini frontend provider wrappers"
```

---

### Task 8: Dynamic Provider Selection in TerminalSession

**Files:**
- Modify: `src/components/TerminalSession.tsx`

- [ ] **Step 1: Add imports and provider factory**

At the top of `TerminalSession.tsx`, add imports:

```typescript
import { createCodexProvider } from '@/providers/codex';
import { createGeminiProvider } from '@/providers/gemini';
import type { AIProvider } from '@/types';
```

Add a factory function before the component:

```typescript
function createProvider(provider: AIProvider, tabId: string) {
  switch (provider) {
    case 'codex': return createCodexProvider(tabId);
    case 'gemini': return createGeminiProvider(tabId);
    default: return createClaudeProvider(tabId);
  }
}
```

- [ ] **Step 2: Add aiProvider prop and wire it up**

Add `aiProvider: AIProvider` to `TerminalSessionProps` interface.

Update the component signature to destructure `aiProvider`.

Replace the hardcoded provider init:

```typescript
// Old (line 46):
const providerRef = useRef(createClaudeProvider(tabId));

// New:
const providerRef = useRef(createProvider(aiProvider, tabId));
```

Add an effect to recreate the provider when `aiProvider` changes:

```typescript
useEffect(() => {
  providerRef.current.stop();
  providerRef.current = createProvider(aiProvider, tabId);
  preambleSentRef.current = false;
}, [aiProvider, tabId]);
```

- [ ] **Step 3: Update approval handler for Gemini**

In the `handleToolApprove` callback, branch on provider:

```typescript
const handleToolApprove = useCallback((item: DisplayItem & { type: 'approval' }) => {
  if (providerRef.current.id === 'gemini') {
    window.tai.gemini.approve(tabId, item.toolUseId, true);
  } else {
    window.tai.ai.approve(tabId, item.toolUseId, true);
  }
  setDisplayItems(prev => prev.map(di =>
    di.type === 'approval' && di.id === item.id
      ? { ...di, status: 'approved' as const }
      : di
  ));
}, [tabId]);
```

Update `handleToolReject` similarly:

```typescript
const handleToolReject = useCallback((item: DisplayItem & { type: 'approval' }) => {
  if (providerRef.current.id === 'gemini') {
    window.tai.gemini.approve(tabId, item.toolUseId, false);
  } else {
    window.tai.ai.approve(tabId, item.toolUseId, false);
  }
  setDisplayItems(prev => prev.map(di =>
    di.type === 'approval' && di.id === item.id
      ? { ...di, status: 'rejected' as const }
      : di
  ));
}, [tabId]);
```

- [ ] **Step 4: Pass aiProvider prop from App.tsx**

In `src/App.tsx`, pass `aiProvider` to `TerminalSession`:

```typescript
<TerminalSession
  tabId={tab.id}
  ptyId={tab.ptyId}
  cwd={tab.cwd}
  visible={tab.id === activeTabId}
  trustLevel={tab.trustLevel}
  aiProvider={tab.aiProvider}
  onContextModeChange={(mode) => handleContextModeChange(tab.id, mode)}
  onRemoteChange={(isRemote, sshTarget) => handleRemoteChange(tab.id, isRemote, sshTarget)}
  remoteExecMode={tab.remoteExecMode}
  onRemoteExecModeChange={(mode) => handleRemoteExecModeChange(tab.id, mode)}
/>
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `cd /var/home/mstephens/Documents/GitHub/tai && npx tsc --noEmit 2>&1 | head -20`

Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/TerminalSession.tsx src/App.tsx
git commit -m "feat: wire dynamic provider selection into TerminalSession"
```

---

### Task 9: Permission Badge on Input Box

**Files:**
- Modify: `src/components/TerminalInput.tsx`
- Modify: `src/components/TerminalInput.module.css`

- [ ] **Step 1: Add Lucide imports and permission label map**

At the top of `TerminalInput.tsx`, add:

```typescript
import { ShieldCheck, ShieldOff } from 'lucide-react';
import type { AIProvider, TrustLevel } from '@/types';

const PERM_LABELS: Record<AIProvider, Record<TrustLevel, string>> = {
  claude: { 'ask': 'Default', 'approve-edits': 'Auto Edits', 'bypass': 'Bypass' },
  codex: { 'ask': 'Auto', 'approve-edits': 'Read-only', 'bypass': 'Full Access' },
  gemini: { 'ask': 'Default', 'approve-edits': 'Auto Edit', 'bypass': 'Yolo' },
};
```

- [ ] **Step 2: Add new props to TerminalInputProps**

Add to the `TerminalInputProps` interface:

```typescript
aiProvider?: AIProvider;
trustLevel?: TrustLevel;
onTrustLevelChange?: (level: TrustLevel) => void;
```

Update the component signature to destructure these new props.

- [ ] **Step 3: Add permission badge JSX**

Inside the `.row` div, after the `.fieldWrap` div and before the `.hint` div (between the input field and the Shift+Tab hint), add the permission badge — only visible in AI mode:

```tsx
{isAI && aiProvider && trustLevel && onTrustLevelChange && (
  <button
    className={`${styles.permBadge} ${trustLevel === 'bypass' ? styles.permDanger : ''}`}
    onClick={(e) => {
      e.stopPropagation();
      const levels: TrustLevel[] = ['ask', 'approve-edits', 'bypass'];
      const idx = levels.indexOf(trustLevel);
      onTrustLevelChange(levels[(idx + 1) % levels.length]);
    }}
    title={`Permissions: ${PERM_LABELS[aiProvider][trustLevel]}`}
  >
    {trustLevel === 'bypass'
      ? <ShieldOff size={12} />
      : <ShieldCheck size={12} />
    }
    <span className={styles.permLabel}>{PERM_LABELS[aiProvider][trustLevel]}</span>
  </button>
)}
```

- [ ] **Step 4: Add CSS styles**

Append to `TerminalInput.module.css`:

```css
.permBadge {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  background: none;
  border: 1px solid transparent;
  border-radius: 4px;
  cursor: pointer;
  color: var(--text-muted);
  font-family: var(--font-sans);
  font-size: 11px;
  white-space: nowrap;
  flex-shrink: 0;
  transition: all 0.15s;
}

.permBadge:hover {
  background: rgba(255, 255, 255, 0.04);
  border-color: rgba(255, 255, 255, 0.08);
  color: var(--text-secondary);
}

.permDanger {
  color: #e35535;
  border-color: #e35535;
  background: rgba(227, 85, 53, 0.1);
}

.permDanger:hover {
  background: rgba(227, 85, 53, 0.2);
}

.permLabel {
  font-size: 11px;
}
```

- [ ] **Step 5: Pass new props from TerminalSession**

In `TerminalSession.tsx`, update the `<TerminalInput>` JSX to pass the new props. Add `aiProvider` and `onTrustLevelChange` to the `TerminalSessionProps` interface and destructure them:

Add to `TerminalSessionProps`:

```typescript
onTrustLevelChange: (level: TrustLevel) => void;
```

Pass to `<TerminalInput>`:

```tsx
<TerminalInput
  ref={inputRef}
  onSubmit={handleSubmit}
  mode={inputMode}
  onModeChange={handleInputModeChange}
  cwd={cwd}
  promptInfo={promptInfo}
  initialValue={editValue}
  disabled={false}
  history={inputHistory}
  onClear={() => setDisplayItems([])}
  remoteExecMode={remoteExecMode}
  onRemoteExecModeChange={onRemoteExecModeChange}
  aiProvider={aiProvider}
  trustLevel={trustLevel}
  onTrustLevelChange={onTrustLevelChange}
/>
```

In `App.tsx`, pass `onTrustLevelChange` to `TerminalSession`:

```tsx
<TerminalSession
  ...
  onTrustLevelChange={(level) => handleTrustLevelChange(level)}
/>
```

Update `handleTrustLevelChange` in App.tsx to accept the tab id or update the active tab — the existing implementation already sets the active tab's trust level, and since `TerminalSession` is only rendered for the active tab, this works:

```typescript
// In App.tsx, update the TerminalSession render:
onTrustLevelChange={(level) => {
  setTabs(prev => prev.map(t => t.id === tab.id ? { ...t, trustLevel: level } : t));
}}
```

- [ ] **Step 6: Verify TypeScript compiles and run tests**

Run: `cd /var/home/mstephens/Documents/GitHub/tai && npx tsc --noEmit 2>&1 | head -20`

Run: `cd /var/home/mstephens/Documents/GitHub/tai && npx vitest run 2>&1 | tail -15`

Expected: No errors, all existing tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/components/TerminalInput.tsx src/components/TerminalInput.module.css src/components/TerminalSession.tsx src/App.tsx
git commit -m "feat: add permission badge to input box with provider-specific labels"
```

---

### Task 10: Provider Selector in QuickSettings & SettingsOverlay

**Files:**
- Modify: `src/components/QuickSettings.tsx`
- Modify: `src/components/SettingsOverlay.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Add provider selector to QuickSettings**

In `QuickSettings.tsx`, add import and props:

```typescript
import type { TrustLevel, AIProvider } from '@/types';
```

Add to `QuickSettingsProps`:

```typescript
aiProvider: AIProvider;
onAIProviderChange: (provider: AIProvider) => void;
```

Add provider options constant:

```typescript
const PROVIDER_OPTIONS = [
  { value: 'claude', label: 'Claude' },
  { value: 'codex', label: 'Codex' },
  { value: 'gemini', label: 'Gemini' },
];
```

Add provider dropdown to the general category section, before the AI Permissions row:

```tsx
<div className={styles.settingRow}>
  <span className={styles.settingLabel}>AI Provider</span>
  <CustomDropdown
    value={aiProvider}
    options={PROVIDER_OPTIONS}
    onChange={(v) => onAIProviderChange(v as AIProvider)}
  />
</div>
```

Update the component signature to destructure `aiProvider` and `onAIProviderChange`.

- [ ] **Step 2: Update SettingsOverlay provider dropdown**

In `SettingsOverlay.tsx`, update the AI Provider section to include Codex and Gemini options:

```tsx
{category === 'ai' && (
  <SettingsGroup>
    <SettingRow label="Provider" value={
      <select value={config['ai.provider']} onChange={e => onSet('ai.provider', e.target.value)}
        className={styles.input}>
        <option value="claude">Claude</option>
        <option value="codex">Codex</option>
        <option value="gemini">Gemini</option>
      </select>
    } />
    <SettingRow label="Model" value={
      <input type="text" value={config['ai.model']} onChange={e => onSet('ai.model', e.target.value)}
        className={styles.input} />
    } />
  </SettingsGroup>
)}
```

- [ ] **Step 3: Wire provider change handler in App.tsx**

Add handler:

```typescript
const handleAIProviderChange = useCallback((provider: AIProvider) => {
  setTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, aiProvider: provider } : t));
}, [activeTabId]);
```

Add import for `AIProvider`:

```typescript
import type { ContextMode, TabState, TrustLevel, AIProvider } from './types';
```

Pass to QuickSettings:

```tsx
<QuickSettings
  visible={quickSettingsOpen}
  onClose={() => setQuickSettingsOpen(false)}
  colorMode={colorMode}
  onColorModeChange={(mode) => setSetting('appearance.colorMode', mode)}
  trustLevel={activeTab.trustLevel}
  onTrustLevelChange={handleTrustLevelChange}
  aiProvider={activeTab.aiProvider}
  onAIProviderChange={handleAIProviderChange}
/>
```

- [ ] **Step 4: Verify TypeScript compiles and run all tests**

Run: `cd /var/home/mstephens/Documents/GitHub/tai && npx tsc --noEmit 2>&1 | head -20`

Run: `cd /var/home/mstephens/Documents/GitHub/tai && npx vitest run 2>&1 | tail -15`

Expected: No errors, all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/QuickSettings.tsx src/components/SettingsOverlay.tsx src/App.tsx
git commit -m "feat: add provider selector to QuickSettings and SettingsOverlay"
```

---

### Task 11: Dev Server Smoke Test

**Files:** None (verification only)

- [ ] **Step 1: Start dev server**

Run: `cd /var/home/mstephens/Documents/GitHub/tai && npm run dev`

- [ ] **Step 2: Verify the app starts without errors**

Check the terminal output for build errors. Open the app in the Electron window.

- [ ] **Step 3: Test permission badge**

1. Type something in the input to switch to AI mode
2. Verify the permission badge appears (ShieldCheck icon + "Default")
3. Click the badge — should cycle through: Default → Auto Edits → Bypass
4. Verify Bypass state shows red styling (ShieldOff icon, red border)
5. Click again to cycle back to Default

- [ ] **Step 4: Test provider selector**

1. Open QuickSettings (Ctrl+,)
2. Verify "AI Provider" dropdown shows Claude/Codex/Gemini
3. Switch to Codex — verify permission badge labels change (Auto / Read-only / Full Access)
4. Switch to Gemini — verify permission badge labels change (Default / Auto Edit / Yolo)
5. Switch back to Claude

- [ ] **Step 5: Test SettingsOverlay**

1. Open Settings (Ctrl+,)
2. Go to AI Provider tab
3. Verify dropdown now shows Claude, Codex, Gemini options

- [ ] **Step 6: Run full test suite**

Run: `cd /var/home/mstephens/Documents/GitHub/tai && npx vitest run 2>&1 | tail -20`

Expected: All tests pass, including the new codexTranslate and geminiTranslate tests.
