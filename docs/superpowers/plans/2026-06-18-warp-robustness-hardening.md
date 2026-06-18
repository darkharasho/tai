# Warp-Grade Robustness Hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close robustness/stability gaps across TAI's terminal, block, remote, and AI subsystems — every change adds a bound, a timeout, a cleanup, or a guard. No new features.

**Architecture:** Three severity-tiered batches (P0 → P1 → P2). Each fix is TDD'd against the real code: write a failing test first; if it can't be made to fail, the audit finding was a false positive — drop it and note why. Batch 2 includes an adversarial-input harness that proves the parse/bound fixes hold.

**Tech Stack:** TypeScript, React (renderer), Electron (main), Vitest (`pool: forks`, `maxForks: 2`), `vi.mock('child_process')` for service tests, `@testing-library/react` for component/hook tests.

## Global Constraints

- Run tests with `npm test` (alias for `vitest run --config tests/vitest.config.ts`). NEVER bare `npx vitest run` — wrong config picks up the renderer fs-shim and fails. Config already caps `maxForks: 2`.
- Baseline: 67 test files green. Every task must leave the full suite green and `npx tsc --noEmit` clean.
- **Never silently empty.** Every bound preserves a head or tail of real data — emptying output already regressed this project once.
- **Settle exactly once.** Every timeout/exit path resolves-or-rejects each pending request exactly once and emits a terminal `done`/error to the renderer, so the UI never stays "thinking."
- Caps are named `const` exports co-located with existing ones (`MAX_PENDING_ESC`, `COMPACT_AT`, `MAX_PERSISTED_BLOCKS`).
- Commit after every task with a `fix(...)` / `test(...)` message.

---

## BATCH 1 — P0 (crash / hang / data-loss / leak)

### Task 1: Bound session block count

Unbounded `displayItems` growth: a long-lived tab accumulates every finished block forever (verified: no cap exists). Cap with tail-eviction so the newest history is always kept.

**Files:**
- Create: `src/utils/blockCap.ts`
- Test: `tests/unit/blockCap.test.ts`
- Modify: `src/components/TerminalSession.tsx` (the `onBlock` finalize `setDisplayItems` at ~442)

**Interfaces:**
- Produces: `MAX_SESSION_BLOCKS: number`, `capDisplayItems<T>(items: T[], max?: number): T[]` — returns the last `max` items if over budget, else the same array reference (no churn when under budget).

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/blockCap.test.ts
import { describe, it, expect } from 'vitest';
import { capDisplayItems, MAX_SESSION_BLOCKS } from '@/utils/blockCap';

describe('capDisplayItems', () => {
  it('returns the same reference when under budget', () => {
    const items = [1, 2, 3];
    expect(capDisplayItems(items, 10)).toBe(items);
  });

  it('keeps only the last `max` items when over budget', () => {
    const items = Array.from({ length: 12 }, (_, i) => i);
    const capped = capDisplayItems(items, 10);
    expect(capped).toHaveLength(10);
    expect(capped[0]).toBe(2);
    expect(capped[9]).toBe(11);
  });

  it('defaults to MAX_SESSION_BLOCKS', () => {
    const items = Array.from({ length: MAX_SESSION_BLOCKS + 5 }, (_, i) => i);
    expect(capDisplayItems(items)).toHaveLength(MAX_SESSION_BLOCKS);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- blockCap`
Expected: FAIL — `Cannot find module '@/utils/blockCap'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/utils/blockCap.ts
// Warp caps persisted blocks at 100; we keep a larger live budget since this
// is in-memory scrollback, evicting oldest so the newest history always shows.
export const MAX_SESSION_BLOCKS = 500;

export function capDisplayItems<T>(items: T[], max: number = MAX_SESSION_BLOCKS): T[] {
  if (items.length <= max) return items;
  return items.slice(items.length - max);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- blockCap`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire into TerminalSession**

Add the import near the other `@/utils` imports:

```ts
import { capDisplayItems } from '@/utils/blockCap';
```

In the `onBlock` finalize handler, wrap the array the `setDisplayItems` updater returns. Find the return at ~line 442–460 that produces the next array (e.g. `return [...next]` / `return next`) and change it to return `capDisplayItems(next)`. Apply the same wrap to the append site at ~line 728 (`setDisplayItems(prev => capDisplayItems([...prev, ...]))`). Only the *append/finalize* sites need it — map/filter updaters that don't grow the array can be left alone.

- [ ] **Step 6: Verify suite + types green**

Run: `npm test && npx tsc --noEmit`
Expected: full suite PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/utils/blockCap.ts tests/unit/blockCap.test.ts src/components/TerminalSession.tsx
git commit -m "fix(blocks): cap session block count with tail-eviction"
```

---

### Task 2: Provider idle/max watchdog

A provider CLI that hangs mid-stream (no `exit`, no output) leaves `state.busy` true and the UI "thinking" forever (verified: `spawn` has no timeout; the `exit` handler already emits `done`, so only the *hang-without-exit* case is unhandled). Add an idle watchdog: kill the process and emit a terminal message if no stdout arrives for `IDLE_TIMEOUT_MS`.

**Files:**
- Create: `electron/services/idleWatchdog.ts`
- Test: `tests/unit/idleWatchdog.test.ts`
- Modify: `electron/services/claude.ts` (wire into the `proc.stdout`/`exit` lifecycle), and apply the same wiring to `codex.ts` and `gemini.ts` spawns.

**Interfaces:**
- Produces: `IDLE_TIMEOUT_MS: number`, `createIdleWatchdog(opts: { idleMs?: number; onIdle: () => void }): { kick(): void; cancel(): void }` — `kick()` (re)arms the timer; `cancel()` clears it; `onIdle` fires once if `idleMs` elapses without a `kick`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/idleWatchdog.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createIdleWatchdog } from '../../electron/services/idleWatchdog';

describe('createIdleWatchdog', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('fires onIdle after idleMs with no kick', () => {
    const onIdle = vi.fn();
    const wd = createIdleWatchdog({ idleMs: 1000, onIdle });
    wd.kick();
    vi.advanceTimersByTime(1001);
    expect(onIdle).toHaveBeenCalledOnce();
  });

  it('does not fire while kicked within idleMs', () => {
    const onIdle = vi.fn();
    const wd = createIdleWatchdog({ idleMs: 1000, onIdle });
    wd.kick();
    vi.advanceTimersByTime(800);
    wd.kick();
    vi.advanceTimersByTime(800);
    expect(onIdle).not.toHaveBeenCalled();
  });

  it('cancel() prevents onIdle', () => {
    const onIdle = vi.fn();
    const wd = createIdleWatchdog({ idleMs: 1000, onIdle });
    wd.kick();
    wd.cancel();
    vi.advanceTimersByTime(2000);
    expect(onIdle).not.toHaveBeenCalled();
  });

  it('fires onIdle at most once', () => {
    const onIdle = vi.fn();
    const wd = createIdleWatchdog({ idleMs: 1000, onIdle });
    wd.kick();
    vi.advanceTimersByTime(5000);
    expect(onIdle).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- idleWatchdog`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// electron/services/idleWatchdog.ts
// Kills a provider process that stops producing output without exiting, so the
// renderer never hangs in a "thinking" state forever.
export const IDLE_TIMEOUT_MS = 120_000;

export function createIdleWatchdog(opts: { idleMs?: number; onIdle: () => void }): {
  kick(): void;
  cancel(): void;
} {
  const idleMs = opts.idleMs ?? IDLE_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let fired = false;

  const cancel = () => {
    if (timer) { clearTimeout(timer); timer = null; }
  };

  return {
    kick() {
      if (fired) return;
      cancel();
      timer = setTimeout(() => {
        fired = true;
        timer = null;
        opts.onIdle();
      }, idleMs);
    },
    cancel,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- idleWatchdog`
Expected: PASS (4 tests).

- [ ] **Step 5: Wire into claude.ts**

After `state.process = proc;` (~line 179) create the watchdog:

```ts
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
```

Add the import at the top: `import { createIdleWatchdog } from './idleWatchdog';`
In the `proc.stdout!.on('data', ...)` handler (~line 182) call `watchdog.kick();` as the first line. In the `proc.on('exit', ...)` handler (~line 296) call `watchdog.cancel();` as the first line. Repeat the identical pattern in `codex.ts` and `gemini.ts` at their `spawn` + stdout/exit sites (use their existing `state`/`win`/`key` equivalents; if a provider has no `state.busy`, gate the `done` emit on its existing in-flight flag).

- [ ] **Step 6: Verify suite + types green**

Run: `npm test && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add electron/services/idleWatchdog.ts tests/unit/idleWatchdog.test.ts electron/services/claude.ts electron/services/codex.ts electron/services/gemini.ts
git commit -m "fix(ai): idle watchdog kills hung provider and settles the turn"
```

---

### Task 3: Guard provider stdin writes

`proc.stdin!.write(...)` in `claude.ts` (lines 454, 614, 656; also 341, 378) is unguarded — if the child died, the write throws and is swallowed, silently losing the prompt. Add a `safeWrite` helper that catches and surfaces.

**Files:**
- Create: `electron/services/procIo.ts`
- Test: `tests/unit/procIo.test.ts`
- Modify: `electron/services/claude.ts` (all `stdin.write` sites)

**Interfaces:**
- Produces: `safeWrite(proc: { stdin: NodeJS.WritableStream | null } | null, data: string, onError?: (err: Error) => void): boolean` — returns `true` if written, `false` (and calls `onError`) if the stream is missing/closed or the write throws.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/procIo.test.ts
import { describe, it, expect, vi } from 'vitest';
import { safeWrite } from '../../electron/services/procIo';

describe('safeWrite', () => {
  it('writes and returns true on a writable stream', () => {
    const write = vi.fn();
    const ok = safeWrite({ stdin: { write } as any }, 'hello\n');
    expect(ok).toBe(true);
    expect(write).toHaveBeenCalledWith('hello\n');
  });

  it('returns false and calls onError when proc is null', () => {
    const onError = vi.fn();
    expect(safeWrite(null, 'x', onError)).toBe(false);
    expect(onError).toHaveBeenCalledOnce();
  });

  it('returns false and calls onError when write throws', () => {
    const onError = vi.fn();
    const write = vi.fn(() => { throw new Error('EPIPE'); });
    expect(safeWrite({ stdin: { write } as any }, 'x', onError)).toBe(false);
    expect(onError).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- procIo`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// electron/services/procIo.ts
// Writing to a dead child's stdin throws (EPIPE) — guard so a crashed provider
// surfaces an error instead of silently swallowing the user's prompt.
export function safeWrite(
  proc: { stdin: NodeJS.WritableStream | null } | null,
  data: string,
  onError?: (err: Error) => void,
): boolean {
  const stdin = proc?.stdin;
  if (!stdin) {
    onError?.(new Error('stdin not available'));
    return false;
  }
  try {
    stdin.write(data);
    return true;
  } catch (err) {
    onError?.(err instanceof Error ? err : new Error(String(err)));
    return false;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- procIo`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire into claude.ts**

Add `import { safeWrite } from './procIo';`. Replace each `state.process?.stdin!.write(X + '\n')` / `proc.stdin.write(X + '\n')` with:

```ts
safeWrite(state.process, X + '\n', (err) => {
  state.busy = false;
  safeSend(win, 'ai:error', key, `Failed to send to AI provider: ${err.message}`);
  safeSend(win, 'ai:message', key, { type: 'done' });
});
```

(For the in-spawn-scope sites that use the local `proc`, pass `{ stdin: proc.stdin }` or `state.process` — both reference the same child.)

- [ ] **Step 6: Verify suite + types green**

Run: `npm test && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add electron/services/procIo.ts tests/unit/procIo.test.ts electron/services/claude.ts
git commit -m "fix(ai): guard provider stdin writes against dead child"
```

---

### Task 4: Kill AI + drop listener on tab unmount

When a tab closes mid-AI-request, the IPC `onMessage` listener and the provider process leak (verified: `aiCleanupRef` is only invoked on graceful `done`/error at lines 988/1002/1126, never on unmount). Extract the cleanup into a hook so it's testable, and run it on unmount.

**Files:**
- Create: `src/hooks/useAiCleanupOnUnmount.ts`
- Test: `tests/unit/useAiCleanupOnUnmount.test.tsx`
- Modify: `src/components/TerminalSession.tsx`

**Interfaces:**
- Consumes: `window.tai.ai.stop` / `window.tai.ai.cancel` (preload.ts:49–50), `aiCleanupRef: MutableRefObject<(() => void) | null>`.
- Produces: `useAiCleanupOnUnmount(tabId: string, cleanupRef: MutableRefObject<(() => void) | null>): void`.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/useAiCleanupOnUnmount.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { useRef } from 'react';
import { useAiCleanupOnUnmount } from '@/hooks/useAiCleanupOnUnmount';

function Harness({ cleanup }: { cleanup: () => void }) {
  const ref = useRef<(() => void) | null>(cleanup);
  useAiCleanupOnUnmount('tab-1', ref);
  return null;
}

describe('useAiCleanupOnUnmount', () => {
  beforeEach(() => {
    (globalThis as any).window = (globalThis as any).window || {};
    (window as any).tai = { ai: { stop: vi.fn(), cancel: vi.fn() } };
  });

  it('invokes the cleanup ref and stops AI on unmount', () => {
    const cleanup = vi.fn();
    const { unmount } = render(<Harness cleanup={cleanup} />);
    unmount();
    expect(cleanup).toHaveBeenCalledOnce();
    expect((window as any).tai.ai.stop).toHaveBeenCalledWith('tab-1');
  });

  it('does not throw when cleanup ref is null', () => {
    const { unmount } = render(<NullHarness />);
    expect(() => unmount()).not.toThrow();
  });
});

function NullHarness() {
  const ref = useRef<(() => void) | null>(null);
  useAiCleanupOnUnmount('tab-1', ref);
  return null;
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- useAiCleanupOnUnmount`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/hooks/useAiCleanupOnUnmount.ts
import { useEffect, type MutableRefObject } from 'react';

// On tab close, an in-flight AI request leaks its IPC listener and child
// process. Drop the listener and stop the provider when the tab unmounts.
export function useAiCleanupOnUnmount(
  tabId: string,
  cleanupRef: MutableRefObject<(() => void) | null>,
): void {
  useEffect(() => {
    return () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
      window.tai?.ai?.stop?.(tabId);
    };
  }, [tabId, cleanupRef]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- useAiCleanupOnUnmount`
Expected: PASS (2 tests).

- [ ] **Step 5: Wire into TerminalSession**

Add `import { useAiCleanupOnUnmount } from '@/hooks/useAiCleanupOnUnmount';` and call `useAiCleanupOnUnmount(tabId, aiCleanupRef);` near the top of the component, after `aiCleanupRef` is declared (~line 192). Use the component's actual tab-id prop name (likely `tabId`; confirm at the call site).

- [ ] **Step 6: Verify suite + types green**

Run: `npm test && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/hooks/useAiCleanupOnUnmount.ts tests/unit/useAiCleanupOnUnmount.test.tsx src/components/TerminalSession.tsx
git commit -m "fix(ai): stop provider and drop listener on tab unmount"
```

---

### Task 5: Daemon per-call timeout

`RemoteDaemonProxy.executeTool` (remoteDaemonProxy.ts:141–154) registers a pending promise with no timeout — a stuck/dead daemon hangs the tool call forever and leaks the `pending` entry. Add a `Promise.race` timeout that resolves with an error result and clears the entry.

**Files:**
- Modify: `electron/services/remoteDaemonProxy.ts`
- Test: `tests/unit/remoteDaemonProxy.test.ts` (create — mirror `remoteSsh.test.ts` `child_process` mock)

**Interfaces:**
- Produces: `DAEMON_CALL_TIMEOUT_MS: number` (exported). `executeTool` unchanged signature, now rejects-as-error-result on timeout and deletes the pending entry.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/remoteDaemonProxy.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockSpawn = vi.fn();
vi.mock('child_process', () => ({ spawn: (...a: any[]) => mockSpawn(...a) }));

import { RemoteDaemonProxy, DAEMON_CALL_TIMEOUT_MS } from '../../electron/services/remoteDaemonProxy';

function mockProc() {
  const proc: any = {
    stdin: { write: vi.fn(), writable: true },
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    killed: false,
    kill: vi.fn(() => { proc.killed = true; }),
    on: vi.fn(),
  };
  return proc;
}

describe('RemoteDaemonProxy.executeTool timeout', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); });
  afterEach(() => vi.useRealTimers());

  it('resolves with an error result if the daemon never responds', async () => {
    const proc = mockProc();
    mockSpawn.mockReturnValue(proc);
    const proxy = new RemoteDaemonProxy('user@host');
    // Force ready without a real handshake.
    (proxy as any).proc = proc;
    (proxy as any).ready = true;

    const p = proxy.executeTool('Bash', { command: 'sleep 999' });
    vi.advanceTimersByTime(DAEMON_CALL_TIMEOUT_MS + 10);
    const result = await p;

    expect(result.isError).toBe(true);
    expect(result.output).toMatch(/timed out/i);
    expect((proxy as any).pending.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- remoteDaemonProxy`
Expected: FAIL — `DAEMON_CALL_TIMEOUT_MS` is undefined / promise never resolves.

- [ ] **Step 3: Write minimal implementation**

At the top of `remoteDaemonProxy.ts` add:

```ts
export const DAEMON_CALL_TIMEOUT_MS = 180_000;
```

Replace `executeTool`'s `return new Promise(...)` body with:

```ts
return new Promise<ToolResult>((resolve) => {
  const timer = setTimeout(() => {
    if (this.pending.delete(id)) {
      resolve({ output: `daemon tool '${toolName}' timed out after ${DAEMON_CALL_TIMEOUT_MS}ms`, isError: true });
    }
  }, DAEMON_CALL_TIMEOUT_MS);
  this.pending.set(id, {
    resolve: (r) => { clearTimeout(timer); resolve(r); },
  });
  this._write({ id, tool: daemonTool, params });
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- remoteDaemonProxy`
Expected: PASS.

- [ ] **Step 5: Verify suite + types green**

Run: `npm test && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add electron/services/remoteDaemonProxy.ts tests/unit/remoteDaemonProxy.test.ts
git commit -m "fix(remote): timeout daemon tool calls and clear pending entry"
```

---

**▶ Batch 1 checkpoint:** `npm test && npx tsc --noEmit`, then in-app smoke test: long session (block cap holds), kill a provider mid-stream (UI settles), close a tab mid-AI (no orphaned process via `ps`), remote tool with daemon down (errors, doesn't hang).

---

## BATCH 2 — P1 (degradation) + adversarial harness

### Task 6: Adversarial-input fixtures

Shared pathological-input generators used by Tasks 7–10. Pure module; a tiny self-test guards it.

**Files:**
- Create: `tests/fixtures/pathological.ts`
- Test: `tests/unit/pathological.test.ts`

**Interfaces:**
- Produces: `pathological: { binarySpew: string; nulBytes: string; invalidUtf8: string; hugeLine: string; unterminatedOsc: string; unterminatedDcs: string; cursorBomb: string; insertLineBomb: string; nestedSgr: string; belFlood: string }`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/pathological.test.ts
import { describe, it, expect } from 'vitest';
import { pathological } from '../fixtures/pathological';

describe('pathological fixtures', () => {
  it('exposes non-empty adversarial strings', () => {
    for (const [k, v] of Object.entries(pathological)) {
      expect(typeof v, k).toBe('string');
      expect(v.length, k).toBeGreaterThan(0);
    }
  });
  it('hugeLine is a single line of ~10MB', () => {
    expect(pathological.hugeLine.length).toBeGreaterThan(5_000_000);
    expect(pathological.hugeLine.includes('\n')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- pathological`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// tests/fixtures/pathological.ts
// Adversarial terminal inputs for robustness regression tests.
const ESC = '\x1b';
export const pathological = {
  binarySpew: Array.from({ length: 4096 }, (_, i) => String.fromCharCode(i % 256)).join(''),
  nulBytes: 'before\x00\x00\x00after',
  invalidUtf8: '\xff\xfe\xfd valid tail',
  hugeLine: 'x'.repeat(10_000_000),
  unterminatedOsc: `${ESC}]6973;` + 'A'.repeat(200_000),
  unterminatedDcs: `${ESC}P` + 'B'.repeat(200_000),
  cursorBomb: `${ESC}[999999B${ESC}[999999C done`,
  insertLineBomb: `${ESC}[999999L done`,
  nestedSgr: `${ESC}[1;2;3;4;5;6;7;38;5;200;48;5;100m`.repeat(2000) + 'text',
  belFlood: '\x07'.repeat(50_000) + 'tail',
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- pathological`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/fixtures/pathological.ts tests/unit/pathological.test.ts
git commit -m "test(robustness): adversarial terminal-input fixtures"
```

---

### Task 7: Bound termEmulator allocations

Cursor moves (`B`/`C`/`E`, termEmulator.ts:316–319) and `IL`/`DL` (`L`/`M`, 355–362) apply unbounded `n` synchronously — `ESC[999999L` splices a million Line objects before compaction can help. Clamp the move/insert counts and the resulting row/col.

**Files:**
- Modify: `src/utils/termEmulator.ts`
- Test: `tests/unit/termEmulatorBounds.test.ts`

**Interfaces:**
- Produces: `MAX_CURSOR_ADVANCE`, `MAX_LINE_OP`, `MAX_COLS` (exported consts).

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/termEmulatorBounds.test.ts
import { describe, it, expect } from 'vitest';
import { TermEmulator } from '@/utils/termEmulator';
import { pathological } from '../fixtures/pathological';

describe('TermEmulator allocation bounds', () => {
  it('does not allocate millions of lines on an insert-line bomb', () => {
    const e = new TermEmulator();
    e.feed(pathological.insertLineBomb);
    expect(e.text().split('\n').length).toBeLessThan(100_000);
  });

  it('does not hang or throw on a cursor bomb', () => {
    const e = new TermEmulator();
    expect(() => e.feed(pathological.cursorBomb)).not.toThrow();
    expect(e.text()).toContain('done');
  });

  it('completes a 10MB single line quickly and bounded', () => {
    const e = new TermEmulator();
    const start = Date.now();
    e.feed(pathological.hugeLine);
    expect(Date.now() - start).toBeLessThan(2000);
  });
});
```

(If `TermEmulator`/`text()` are not the exact exports, align the imports with `termEmulator.ts` — adjust the test, not the production API.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- termEmulatorBounds`
Expected: FAIL — insert-line bomb produces ~1M lines (or times out).

- [ ] **Step 3: Write minimal implementation**

Add near the top consts (~line 34):

```ts
const MAX_CURSOR_ADVANCE = 10_000;
const MAX_LINE_OP = 10_000;
const MAX_COLS = 10_000;
export { MAX_CURSOR_ADVANCE, MAX_LINE_OP, MAX_COLS };
```

In `_handleCsi`, clamp:
- `case 'B': this._row += Math.min(n || 1, MAX_CURSOR_ADVANCE); this._line(); break;`
- `case 'C': this._col = Math.min(this._col + (n || 1), MAX_COLS); break;`
- `case 'E': this._row += Math.min(n || 1, MAX_CURSOR_ADVANCE); this._col = 0; this._line(); break;`
- `case 'G': this._col = Math.max(0, Math.min((n || 1) - 1, MAX_COLS)); break;`
- IL: `const count = Math.min(n || 1, MAX_LINE_OP); const blanks = Array.from({ length: count }, () => ({ chars: [] as string[], sgrs: [] as string[] })); this._lines.splice(this._row, 0, ...blanks);`
- DL: `this._lines.splice(this._row, Math.min(n || 1, MAX_LINE_OP)); this._line();`

Also clamp `H`/`f` column (line 326–327) with `Math.min(..., MAX_COLS)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- termEmulatorBounds`
Expected: PASS.

- [ ] **Step 5: Verify no regression in existing emulator tests**

Run: `npm test -- termEmulator`
Expected: PASS (bounds test + the existing `termEmulator.test.ts` oracle suite).

- [ ] **Step 6: Commit**

```bash
git add src/utils/termEmulator.ts tests/unit/termEmulatorBounds.test.ts
git commit -m "fix(term): clamp cursor/insert-line allocation against escape bombs"
```

---

### Task 8: Cap OSC/DCS payload in BlockSegmenter

A valid-but-huge OSC/DCS payload (e.g. `ESC]6973;<1MB>`) accumulates unbounded in the raw prompt/command buffers before being fed to the emulator. Cap the payload at the route boundary.

**Files:**
- Modify: `src/components/BlockSegmenter.ts` (the `_routeChunk` / OSC-accumulation site that feeds `_osc133RawPrompt` / `_osc133RawCommand`)
- Test: `tests/unit/blockSegmenterOscCap.test.ts`

**Interfaces:**
- Produces: `MAX_OSC_PAYLOAD` (exported const). OSC/DCS payloads longer than the cap are truncated (keep the head; the marker semantics live at the start).

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/blockSegmenterOscCap.test.ts
import { describe, it, expect } from 'vitest';
import { BlockSegmenter, MAX_OSC_PAYLOAD } from '@/components/BlockSegmenter';
import { pathological } from '../fixtures/pathological';

describe('BlockSegmenter OSC/DCS payload cap', () => {
  it('does not retain an unbounded OSC payload', () => {
    const seg = new BlockSegmenter();
    expect(() => seg.feed(pathological.unterminatedOsc)).not.toThrow();
    // Internal raw buffer must stay bounded.
    const raw = (seg as any)._osc133RawPrompt ?? (seg as any)._osc133RawCommand ?? '';
    expect(raw.length).toBeLessThanOrEqual(MAX_OSC_PAYLOAD + 16);
  });
});
```

(Confirm the actual private field name and `feed` entrypoint in `BlockSegmenter.ts`; align the assertion to whichever raw buffer the OSC path fills.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- blockSegmenterOscCap`
Expected: FAIL — raw buffer grows to ~200KB (> cap) or `MAX_OSC_PAYLOAD` undefined.

- [ ] **Step 3: Write minimal implementation**

Add `export const MAX_OSC_PAYLOAD = 64 * 1024;` near the top. At the site where OSC/DCS bytes are appended to the raw prompt/command buffer, guard the append so the buffer never exceeds the cap (truncate further bytes for that sequence):

```ts
if (this._osc133RawCommand.length < MAX_OSC_PAYLOAD) {
  this._osc133RawCommand += chunkSlice.slice(0, MAX_OSC_PAYLOAD - this._osc133RawCommand.length);
}
```

Apply the equivalent guard to the prompt buffer and any DCS accumulation path.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- blockSegmenterOscCap`
Expected: PASS.

- [ ] **Step 5: Verify no regression**

Run: `npm test -- BlockSegmenter`
Expected: PASS (existing segmenter suites unaffected for normal-sized OSC).

- [ ] **Step 6: Commit**

```bash
git add src/components/BlockSegmenter.ts tests/unit/blockSegmenterOscCap.test.ts
git commit -m "fix(term): cap OSC/DCS payload accumulation in BlockSegmenter"
```

---

### Task 9: ansiToHtml truncated-SGR guard

`parse256Color` (ansiToHtml.ts:19–40) reads `codes[i+2]`/`codes[i+4]` and `Number`-parses them; a truncated `ESC[38;5m` yields `NaN`, producing `rgb(NaN,...)`. Guard the bounds and reject NaN.

**Files:**
- Modify: `src/utils/ansiToHtml.ts`
- Test: `tests/unit/ansiToHtmlSafety.test.ts`

**Interfaces:** none new (internal hardening).

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/ansiToHtmlSafety.test.ts
import { describe, it, expect } from 'vitest';
import { ansiToHtml } from '@/utils/ansiToHtml';
import { pathological } from '../fixtures/pathological';

describe('ansiToHtml malformed-SGR safety', () => {
  it('never emits NaN for truncated 256/RGB sequences', () => {
    expect(ansiToHtml('\x1b[38;5mhello')).not.toContain('NaN');
    expect(ansiToHtml('\x1b[38;2;10mhello')).not.toContain('NaN');
    expect(ansiToHtml('\x1b[48;5;mhello')).not.toContain('NaN');
  });
  it('does not throw on nested-SGR or binary spew', () => {
    expect(() => ansiToHtml(pathological.nestedSgr)).not.toThrow();
    expect(() => ansiToHtml(pathological.binarySpew)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- ansiToHtmlSafety`
Expected: FAIL — output contains `NaN`.

- [ ] **Step 3: Write minimal implementation**

In `parse256Color`, replace the two branches with NaN-safe guards:

```ts
if (codes[i + 1] === 5) {
  const n = codes[i + 2];
  if (n == null || Number.isNaN(n)) return { color: null, consumed: 2 };
  // ... existing 16 / 216 / grayscale logic ...
}
if (codes[i + 1] === 2) {
  const r = codes[i + 2], g = codes[i + 3], b = codes[i + 4];
  if ([r, g, b].some((v) => v == null || Number.isNaN(v))) return { color: null, consumed: 2 };
  return { color: `rgb(${r},${g},${b})`, consumed: 5 };
}
return { color: null, consumed: 1 };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- ansiToHtmlSafety`
Expected: PASS.

- [ ] **Step 5: Verify no regression**

Run: `npm test -- ansiToHtml outputWindow`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/utils/ansiToHtml.ts tests/unit/ansiToHtmlSafety.test.ts
git commit -m "fix(term): NaN-safe 256/RGB color parsing in ansiToHtml"
```

---

### Task 10: Adversarial-pipeline integration sweep

With Tasks 7–9 done, assert the whole `termEmulator → ansiToHtml` pipeline stays bounded and throw-free across every fixture. This is the regression net.

**Files:**
- Create: `tests/unit/adversarialInput.test.ts`

**Interfaces:** none.

- [ ] **Step 1: Write the test (should pass now that 7–9 landed)**

```ts
// tests/unit/adversarialInput.test.ts
import { describe, it, expect } from 'vitest';
import { TermEmulator } from '@/utils/termEmulator';
import { ansiToHtml } from '@/utils/ansiToHtml';
import { pathological } from '../fixtures/pathological';

describe('adversarial input pipeline', () => {
  for (const [name, input] of Object.entries(pathological)) {
    it(`is bounded and throw-free: ${name}`, () => {
      const e = new TermEmulator();
      const start = Date.now();
      expect(() => e.feed(input)).not.toThrow();
      const text = e.text();
      expect(text.split('\n').length).toBeLessThan(100_000);
      expect(() => ansiToHtml(text)).not.toThrow();
      expect(Date.now() - start).toBeLessThan(3000);
    });
  }
});
```

- [ ] **Step 2: Run it**

Run: `npm test -- adversarialInput`
Expected: PASS for every fixture. If any fails, the corresponding bound (Task 7/8/9) is incomplete — fix there, not by loosening the assertion.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/adversarialInput.test.ts
git commit -m "test(robustness): adversarial-input pipeline sweep"
```

---

### Task 11: Cap stored per-block streaming output

The active block's stored `output`/`rawOutput` grows unbounded as a command streams (TerminalSession.tsx:529); only the *display* is windowed. Cap the stored buffers, preserving the tail.

**Files:**
- Create: `src/utils/clampStoredOutput.ts`
- Test: `tests/unit/clampStoredOutput.test.ts`
- Modify: `src/components/TerminalSession.tsx` (the `onOutput` updater at ~523–529)

**Interfaces:**
- Produces: `MAX_STORED_OUTPUT_CHARS: number`, `clampStoredOutput(s: string, max?: number): string` — returns the tail when over budget, prefixed with a one-line `…[N earlier chars truncated]\n` marker.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/clampStoredOutput.test.ts
import { describe, it, expect } from 'vitest';
import { clampStoredOutput, MAX_STORED_OUTPUT_CHARS } from '@/utils/clampStoredOutput';

describe('clampStoredOutput', () => {
  it('returns the input unchanged when under budget', () => {
    expect(clampStoredOutput('hello', 100)).toBe('hello');
  });
  it('keeps the tail and notes truncation when over budget', () => {
    const out = clampStoredOutput('a'.repeat(1000), 100);
    expect(out.length).toBeLessThan(200);
    expect(out).toContain('truncated');
    expect(out.endsWith('a')).toBe(true);
  });
  it('has a sane default budget', () => {
    expect(MAX_STORED_OUTPUT_CHARS).toBeGreaterThan(100_000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- clampStoredOutput`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/utils/clampStoredOutput.ts
// Active-command output is stored in full for copy/AI even though only a window
// renders. Bound the stored buffer so a runaway command can't exhaust memory.
export const MAX_STORED_OUTPUT_CHARS = 1_000_000;

export function clampStoredOutput(s: string, max: number = MAX_STORED_OUTPUT_CHARS): string {
  if (s.length <= max) return s;
  const dropped = s.length - max;
  return `…[${dropped} earlier chars truncated]\n` + s.slice(s.length - max);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- clampStoredOutput`
Expected: PASS.

- [ ] **Step 5: Wire into TerminalSession**

Import it, and in the `onOutput` updater wrap both fields:

```ts
next[idx] = { ...item, block: { ...item.block, output: clampStoredOutput(current.clean), rawOutput: clampStoredOutput(current.raw) } };
```

- [ ] **Step 6: Verify suite + types green**

Run: `npm test && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/utils/clampStoredOutput.ts tests/unit/clampStoredOutput.test.ts src/components/TerminalSession.tsx
git commit -m "fix(blocks): cap stored per-block streaming output, keep tail"
```

---

### Task 12: Quota-aware sessionRestore

`persistBlocks` swallows `QuotaExceededError` silently (sessionRestore.ts:37) — once localStorage fills, all future history saves fail unnoticed. On quota failure, shed this tab's oldest persisted blocks and retry once; surface a single console warning.

**Files:**
- Modify: `src/utils/sessionRestore.ts`
- Test: `tests/unit/sessionRestoreQuota.test.ts`

**Interfaces:** `persistBlocks` signature unchanged; gains retry-after-shed behavior.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/sessionRestoreQuota.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { persistBlocks } from '@/utils/sessionRestore';

function makeItems(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    type: 'command' as const, active: false,
    block: { id: `b${i}`, command: `cmd ${i}`, output: 'x'.repeat(500), rawOutput: 'x'.repeat(500) },
  })) as any;
}

describe('persistBlocks quota handling', () => {
  let store: Record<string, string>;
  beforeEach(() => {
    store = {};
    let failOnce = true;
    (globalThis as any).localStorage = {
      getItem: (k: string) => store[k] ?? null,
      removeItem: (k: string) => { delete store[k]; },
      setItem: vi.fn((k: string, v: string) => {
        if (failOnce && v.length > 2000) {
          failOnce = false;
          const e: any = new Error('quota'); e.name = 'QuotaExceededError'; throw e;
        }
        store[k] = v;
      }),
    };
  });

  it('sheds oldest blocks and retries on QuotaExceededError', () => {
    persistBlocks('tab-1', makeItems(40));
    // After a quota failure it should have retried with fewer blocks and succeeded.
    expect(store['tai:session:tab-1']).toBeTruthy();
    const saved = JSON.parse(store['tai:session:tab-1']);
    expect(saved.blocks.length).toBeLessThan(40);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- sessionRestoreQuota`
Expected: FAIL — nothing saved (quota error swallowed, no retry).

- [ ] **Step 3: Write minimal implementation**

Refactor `persistBlocks` so the block-building is reusable and add a shed-and-retry:

```ts
export function persistBlocks(tabId: string, items: DisplayItem[]): void {
  const all = items
    .filter((i): i is DisplayItem & { type: 'command' } =>
      i.type === 'command' && !i.active && i.block.id !== 'pending')
    .slice(-MAX_PERSISTED_BLOCKS)
    .map(({ block }) => ({
      ...block,
      output: tailLines(block.output, MAX_PERSISTED_LINES).text,
      rawOutput: tailLines(block.rawOutput, MAX_PERSISTED_LINES).text,
    }));

  for (let blocks = all; ; blocks = blocks.slice(Math.ceil(blocks.length / 2))) {
    const payload: Payload = { v: VERSION, savedAt: Date.now(), blocks };
    try {
      localStorage.setItem(keyFor(tabId), JSON.stringify(payload));
      return;
    } catch (e) {
      if (blocks.length > 1 && (e as any)?.name === 'QuotaExceededError') {
        console.warn(`[sessionRestore] quota exceeded for ${tabId}; shedding to ${Math.ceil(blocks.length / 2)} blocks`);
        continue;
      }
      return; // non-quota or down to one block — best-effort, give up
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- sessionRestoreQuota`
Expected: PASS.

- [ ] **Step 5: Verify no regression**

Run: `npm test -- sessionRestore`
Expected: PASS (existing `sessionRestore` tests, if any, plus this one).

- [ ] **Step 6: Commit**

```bash
git add src/utils/sessionRestore.ts tests/unit/sessionRestoreQuota.test.ts
git commit -m "fix(restore): shed oldest blocks and retry on localStorage quota"
```

---

### Task 13: SSH depth-drift hard reset

If a remote command dies before its OSC 133 `D`, `_cmdDepth`/`_sshDepth` drift and TAI stays stuck in the SSH-session state (BlockSegmenter SSH state machine). Make the `SSH_CLOSED_RE` match an unconditional reset of both depth counters and the SSH-session flag, regardless of the depth comparison.

**Files:**
- Modify: `src/components/BlockSegmenter.ts` (the `SSH_CLOSED_RE` handling + `_setSshSession`)
- Test: `tests/unit/blockSegmenterSshReset.test.ts`

**Interfaces:** none new.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/blockSegmenterSshReset.test.ts
import { describe, it, expect } from 'vitest';
import { BlockSegmenter } from '@/components/BlockSegmenter';

describe('SSH close hard-reset', () => {
  it('clears ssh session state even if depth counters drifted', () => {
    const seg = new BlockSegmenter();
    const ssh: boolean[] = [];
    seg.onSshSession((active: boolean) => ssh.push(active));

    // Simulate entering an ssh session, then a drifted depth, then a close line.
    (seg as any)._inSshSession = true;
    (seg as any)._sshDepth = 2;
    (seg as any)._cmdDepth = 5; // drifted — never decremented back below sshDepth
    seg.feed('Connection to host closed.\n');

    expect((seg as any)._inSshSession).toBe(false);
    expect((seg as any)._sshDepth).toBe(0);
    expect((seg as any)._cmdDepth).toBe(0);
    expect(ssh.at(-1)).toBe(false);
  });
});
```

(Align private field names and the `feed`/close-detection entrypoint to the real `BlockSegmenter`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- blockSegmenterSshReset`
Expected: FAIL — still `_inSshSession === true` (depth guard blocked the clear).

- [ ] **Step 3: Write minimal implementation**

At the `SSH_CLOSED_RE` match site, before/instead of the depth-gated clear:

```ts
if (SSH_CLOSED_RE.test(line)) {
  this._sshDepth = 0;
  this._cmdDepth = 0;
  if (this._inSshSession) this._setSshSession(false, null);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- blockSegmenterSshReset`
Expected: PASS.

- [ ] **Step 5: Verify no regression**

Run: `npm test -- BlockSegmenter sshDetect`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/BlockSegmenter.ts tests/unit/blockSegmenterSshReset.test.ts
git commit -m "fix(ssh): hard-reset depth counters and session flag on close"
```

---

### Task 14: Daemon heartbeat pong timeout + reject pending on exit

The daemon pings every 30s but never checks for pongs (remoteDaemonProxy.ts:130–134) — a silently dead daemon stays "connected" indefinitely. Track the last pong and tear down on overdue. Confirm `_handleExit` settles all pending (it already resolves-as-error; keep that — callers read `isError`).

**Files:**
- Modify: `electron/services/remoteDaemonProxy.ts`
- Test: extend `tests/unit/remoteDaemonProxy.test.ts`

**Interfaces:**
- Produces: `PONG_TIMEOUT_MS` (exported). Heartbeat records `_lastPong`; if `now - _lastPong > PONG_TIMEOUT_MS`, calls `_handleExit()`.

- [ ] **Step 1: Write the failing test**

```ts
// append to tests/unit/remoteDaemonProxy.test.ts
import { PONG_TIMEOUT_MS } from '../../electron/services/remoteDaemonProxy';

it('disconnects when pongs stop arriving', () => {
  vi.useFakeTimers();
  const proc = mockProc();
  mockSpawn.mockReturnValue(proc);
  const proxy = new RemoteDaemonProxy('user@host');
  (proxy as any).proc = proc;
  const onDisconnect = vi.fn();
  proxy.setOnDisconnect(onDisconnect);

  // Simulate ready → starts heartbeat and sets _lastPong.
  (proxy as any)._handleMessage({ type: 'ready' });
  // No pongs ever arrive.
  vi.advanceTimersByTime(PONG_TIMEOUT_MS + 60_000);

  expect(proxy.isConnected()).toBe(false);
  expect(onDisconnect).toHaveBeenCalled();
  vi.useRealTimers();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- remoteDaemonProxy`
Expected: FAIL — `PONG_TIMEOUT_MS` undefined / still connected.

- [ ] **Step 3: Write minimal implementation**

Add `export const PONG_TIMEOUT_MS = 90_000;` and a `private _lastPong = 0;` field. In `_handleMessage`, on `ready` and on `pong` set `this._lastPong = Date.now();`. Rewrite `_startHeartbeat`:

```ts
private _startHeartbeat() {
  this._lastPong = Date.now();
  this.pingInterval = setInterval(() => {
    if (Date.now() - this._lastPong > PONG_TIMEOUT_MS) {
      this._handleExit();
      return;
    }
    this._write({ type: 'ping' });
  }, 30000);
}
```

(`_handleExit` already clears the interval, settles pending, and fires `onDisconnect` — no change needed there.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- remoteDaemonProxy`
Expected: PASS.

- [ ] **Step 5: Verify suite + types green**

Run: `npm test && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add electron/services/remoteDaemonProxy.ts tests/unit/remoteDaemonProxy.test.ts
git commit -m "fix(remote): tear down daemon when heartbeat pongs stop"
```

---

### Task 15: Reject pending SSH commands on process exit

`RemoteSshManager`'s `exit` handler (remoteSsh.ts:39–41) only deletes the session — an in-flight `execute()` hangs until its own timeout. Reject the pending command immediately on exit.

**Files:**
- Modify: `electron/services/remoteSsh.ts`
- Test: extend `tests/unit/remoteSsh.test.ts`

**Interfaces:** none new.

- [ ] **Step 1: Write the failing test**

```ts
// append to tests/unit/remoteSsh.test.ts
it('rejects an in-flight command when the ssh process exits', async () => {
  const proc = createMockProcess();
  mockSpawn.mockReturnValue(proc);

  let exitHandler: Function = () => {};
  proc.on.mockImplementation((event: string, cb: Function) => {
    if (event === 'exit') exitHandler = cb;
  });

  const { stdoutHandler } = await connectWithHandlers(proc);
  void stdoutHandler; // not needed here

  const p = manager.execute('tab-1', 'sleep 999', 30000);
  // Process dies mid-command.
  exitHandler();

  await expect(p).rejects.toThrow(/connection lost|exited/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- remoteSsh`
Expected: FAIL — promise stays pending (test times out).

- [ ] **Step 3: Write minimal implementation**

Replace the `proc.on('exit', ...)` body in `connect`:

```ts
proc.on('exit', () => {
  const s = this.sessions.get(tabId);
  if (s?.pendingReject) {
    s.pendingReject(new Error('SSH connection lost (process exited)'));
    s.pendingResolve = null;
    s.pendingReject = null;
  }
  this.sessions.delete(tabId);
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- remoteSsh`
Expected: PASS (existing 9 + this one).

- [ ] **Step 5: Verify suite + types green**

Run: `npm test && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add electron/services/remoteSsh.ts tests/unit/remoteSsh.test.ts
git commit -m "fix(ssh): reject in-flight command when ssh process exits"
```

---

### Task 16: Classify provider stderr

Provider stderr is forwarded raw as `ai:error` (claude.ts:290–294) — auth failures, rate limits, and crash-loop floods all look identical and unthrottled. Classify into a structured category so the renderer can show meaningful, deduped errors.

**Files:**
- Create: `src/utils/classifyProviderError.ts`
- Test: `tests/unit/classifyProviderError.test.ts`
- Modify: `electron/services/claude.ts` stderr handler (attach `category` to the `ai:error` payload — additive, renderer can ignore it initially).

**Interfaces:**
- Produces: `classifyProviderError(text: string): { category: 'auth' | 'rate-limit' | 'permission' | 'network' | 'unknown'; message: string }`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/classifyProviderError.test.ts
import { describe, it, expect } from 'vitest';
import { classifyProviderError } from '@/utils/classifyProviderError';

describe('classifyProviderError', () => {
  it('detects auth errors', () => {
    expect(classifyProviderError('Error: 401 Unauthorized').category).toBe('auth');
    expect(classifyProviderError('invalid api key').category).toBe('auth');
  });
  it('detects rate limits', () => {
    expect(classifyProviderError('429 Too Many Requests').category).toBe('rate-limit');
  });
  it('detects network errors', () => {
    expect(classifyProviderError('ECONNREFUSED').category).toBe('network');
  });
  it('falls back to unknown', () => {
    expect(classifyProviderError('something else').category).toBe('unknown');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- classifyProviderError`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/utils/classifyProviderError.ts
export function classifyProviderError(text: string): {
  category: 'auth' | 'rate-limit' | 'permission' | 'network' | 'unknown';
  message: string;
} {
  const t = text.toLowerCase();
  let category: ReturnType<typeof classifyProviderError>['category'] = 'unknown';
  if (/\b401\b|unauthorized|invalid api key|authentication|not logged in/.test(t)) category = 'auth';
  else if (/\b429\b|rate limit|too many requests|quota/.test(t)) category = 'rate-limit';
  else if (/permission denied|forbidden|\b403\b/.test(t)) category = 'permission';
  else if (/econnrefused|etimedout|enotfound|network|getaddrinfo/.test(t)) category = 'network';
  return { category, message: text.trim() };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- classifyProviderError`
Expected: PASS.

- [ ] **Step 5: Wire into claude.ts (additive)**

In the stderr handler, send the category alongside the text:

```ts
const { category } = classifyProviderError(text);
safeSend(win, 'ai:error', key, text, category);
```

(If `safeSend`'s signature is fixed-arity, instead send `{ text, category }` as the payload and leave the renderer to read `.text` — verify the existing `ai:error` payload shape first and stay backward-compatible.)

- [ ] **Step 6: Verify suite + types green**

Run: `npm test && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/utils/classifyProviderError.ts tests/unit/classifyProviderError.test.ts electron/services/claude.ts
git commit -m "fix(ai): classify provider stderr into structured categories"
```

---

**▶ Batch 2 checkpoint:** `npm test && npx tsc --noEmit`, then in-app smoke: `cat` a huge file (no jank/OOM, output windowed), `printf '\e[999999L'` over SSH (no freeze), pull SSH cable mid-remote (session clears, no stuck state), trigger an auth error (clear message).

---

## BATCH 3 — P2 (polish)

### Task 17: Clear stray timers on unmount

Timers like `daemonToastTimerRef` are set but not cleared on unmount, firing `setState` on a dead component. Add an unmount cleanup that clears all such refs.

**Files:**
- Modify: `src/components/TerminalSession.tsx`
- Test: covered by in-app smoke (React state-after-unmount warning disappears); no isolated unit test — the timers are private component refs. Note this explicitly in the commit.

- [ ] **Step 1: Add the cleanup effect**

Near the other unmount effects, add:

```ts
useEffect(() => () => {
  for (const r of [daemonToastTimerRef, sessionPromoteTimerRef]) {
    if (r.current) { clearTimeout(r.current); r.current = null; }
  }
}, []);
```

(Enumerate every `…TimerRef` declared in the component; grep `TimerRef` to be exhaustive.)

- [ ] **Step 2: Verify suite + types green**

Run: `npm test && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Manual check**

Open a tab that shows the daemon toast, close it immediately, confirm no "setState on unmounted component" warning in DevTools console.

- [ ] **Step 4: Commit**

```bash
git add src/components/TerminalSession.tsx
git commit -m "fix(blocks): clear stray timers on tab unmount"
```

---

### Task 18: Purge stale temp files on startup

MCP server/config/history temp files are cleaned on graceful provider exit (claude.ts:305–307) but leak if TAI crashes. Sweep stale `tai-*` temp files older than a day at app startup.

**Files:**
- Create: `electron/services/tempCleanup.ts`
- Test: `tests/unit/tempCleanup.test.ts`
- Modify: the app `whenReady`/startup path (e.g. `electron/main.ts`) to call it once.

**Interfaces:**
- Produces: `purgeStaleTempFiles(dir: string, now?: number, maxAgeMs?: number): number` — deletes matching stale files, returns the count removed. Pure-ish (takes `dir`/`now` for testing).

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/tempCleanup.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { purgeStaleTempFiles } from '../../electron/services/tempCleanup';

describe('purgeStaleTempFiles', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taitest-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('removes stale tai temp files but keeps fresh and unrelated ones', () => {
    const stale = path.join(dir, 'tai-mcp-server-old.cjs');
    const fresh = path.join(dir, 'tai-mcp-server-new.cjs');
    const other = path.join(dir, 'unrelated.txt');
    fs.writeFileSync(stale, 'x'); fs.writeFileSync(fresh, 'x'); fs.writeFileSync(other, 'x');
    const old = Date.now() - 2 * 24 * 3600 * 1000;
    fs.utimesSync(stale, old / 1000, old / 1000);

    const removed = purgeStaleTempFiles(dir, Date.now(), 24 * 3600 * 1000);

    expect(removed).toBe(1);
    expect(fs.existsSync(stale)).toBe(false);
    expect(fs.existsSync(fresh)).toBe(true);
    expect(fs.existsSync(other)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tempCleanup`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// electron/services/tempCleanup.ts
import * as fs from 'fs';
import * as path from 'path';

const TAI_TEMP_RE = /^tai-(mcp-server|mcp-config|ssh-config|history)/;

// TAI writes per-request temp files cleaned on graceful provider exit; a crash
// orphans them. Sweep stale ones at startup.
export function purgeStaleTempFiles(dir: string, now = Date.now(), maxAgeMs = 24 * 3600 * 1000): number {
  let removed = 0;
  let entries: string[];
  try { entries = fs.readdirSync(dir); } catch { return 0; }
  for (const name of entries) {
    if (!TAI_TEMP_RE.test(name)) continue;
    const full = path.join(dir, name);
    try {
      if (now - fs.statSync(full).mtimeMs > maxAgeMs) { fs.unlinkSync(full); removed++; }
    } catch { /* ignore */ }
  }
  return removed;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tempCleanup`
Expected: PASS.

- [ ] **Step 5: Wire into startup**

In the main-process ready handler, call once: `purgeStaleTempFiles(os.tmpdir());` (import `os` and `purgeStaleTempFiles`). Confirm the actual main entry file name before editing.

- [ ] **Step 6: Verify suite + types green**

Run: `npm test && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add electron/services/tempCleanup.ts tests/unit/tempCleanup.test.ts electron/main.ts
git commit -m "fix(temp): purge stale tai temp files on startup"
```

---

### Task 19: Warn on partial output at provider exit

When a provider exits with a non-empty unparsed `state.buffer` (a truncated JSON line), the partial is dropped silently. Emit a one-line warning so the user knows the response may be incomplete.

**Files:**
- Modify: `electron/services/claude.ts` (the `proc.on('exit')` handler, ~296–309)
- Test: covered by the existing exit-path behavior; add a focused assertion only if `claude.ts` exposes a testable seam. Otherwise verify by inspection + in-app. Note in commit.

- [ ] **Step 1: Add the warning**

In the exit handler, before the `done` emit:

```ts
if (state.buffer && state.buffer.trim()) {
  safeSend(win, 'ai:error', key, 'Response may be incomplete — provider exited mid-output.');
  state.buffer = '';
}
```

- [ ] **Step 2: Verify suite + types green**

Run: `npm test && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add electron/services/claude.ts
git commit -m "fix(ai): warn when provider exits with partial buffered output"
```

---

**▶ Batch 3 checkpoint:** `npm test && npx tsc --noEmit`, full in-app regression pass, then update the relevant memory file noting the hardening shipped (uncommitted vs released per the project's release flow).

---

## Self-Review

- **Spec coverage:** Theme A → Tasks 1, 7, 8, 11, 12 (+ termEmulator existing compaction confirmed sufficient for the rest). Theme B → Tasks 2, 5, 14. Theme C → Tasks 3, 4, 15, 17, 18. Theme D → Tasks 7, 8, 9, 13. Theme E → Tasks 16, 19. Adversarial harness → Tasks 6, 10. All spec sections map to tasks.
- **Debunked findings excluded:** no task touches the `remoteSsh` "missing timeout" (already exists) or the `BlockSegmenter` callback "leak" (per-tab `useRef`, single registration) — correctly dropped.
- **Placeholder scan:** every code step shows real code; private-field/entrypoint names that must be confirmed against the real file are flagged inline as "align/confirm," not left as TODO.
- **Type consistency:** `capDisplayItems`, `createIdleWatchdog`, `safeWrite`, `clampStoredOutput`, `classifyProviderError`, `purgeStaleTempFiles`, `DAEMON_CALL_TIMEOUT_MS`, `PONG_TIMEOUT_MS` are each defined once and referenced with matching signatures.
- **Non-unit-testable tasks (17, 19, parts of 16):** explicitly marked as inspection + in-app verification rather than faking a unit test, because the seams are private component/handler internals.
