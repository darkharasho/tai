# Terminal Pipeline Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden TAI's PTY → renderer pipeline against (1) missing DECSET terminal modes, (2) resize races corrupting the segmenter, and (3) unbounded PTY backpressure under floods.

**Architecture:** Three commits on one branch, shipped together as one PR / one release. Each commit is independently reviewable. Pure logic is extracted into testable modules (`resizeQueue`, `coalescingBuffer`, `backpressureGate`) under `electron/services/`; `pty.ts` wires them together. The segmenter learns a single new method `onResize()`. The renderer ACKs xterm.js parse completion to drive backpressure.

**Tech Stack:** TypeScript, Electron (main + preload + renderer), `node-pty`, `xterm.js` 5.5.0, Vitest.

**Spec:** `docs/superpowers/specs/2026-05-16-terminal-pipeline-hardening-design.md`

**Branch:** Create one feature branch (e.g., `terminal-pipeline-hardening`) and land all three commits on it before opening the PR.

---

## File Structure

**New files:**
- `electron/services/resizeQueue.ts` — pure module: coalescing resize queue with last-write-wins semantics
- `electron/services/coalescingBuffer.ts` — pure module: accumulates PTY chunks within an event-loop tick, flushes once
- `electron/services/backpressureGate.ts` — pure module: high/low-water state machine for pause/resume
- `tests/unit/resizeQueue.test.ts`
- `tests/unit/coalescingBuffer.test.ts`
- `tests/unit/backpressureGate.test.ts`

**Modified files:**
- `electron/services/pty.ts` — wires the three new modules; emits `pty:resized`; handles `pty:data-ack`
- `electron/preload.ts` — exposes `onResized` and `dataAck` on `window.tai.pty`
- `src/components/HiddenXterm.tsx` — debounced ResizeObserver; window focus/blur → xterm.focus/blur; xterm.write completion callback drives ACKs
- `src/components/BlockSegmenter.ts` — new `onResize()` method that flushes partial lines
- `src/components/TerminalSession.tsx` — subscribes to `pty:resized`, calls `segmenter.onResize()`
- `tests/unit/BlockSegmenter.test.ts` — new `describe('onResize')`

---

# Commit 1: DECSET modes

Goal: enable mouse reporting, bracketed paste, and focus events in xterm.js. xterm.js 5.5.0 honors `?1000/1002/1003/1006` (mouse), `?2004` (bracketed paste), and `?1004` (focus) automatically when the running app emits the DECSET. Our only code change is wiring window-level focus/blur into xterm's focus/blur so it can emit `CSI I`/`CSI O`.

### Task 1.1: Verify DECSET modes work, wire window focus, manual smoke

**Files:**
- Modify: `src/components/HiddenXterm.tsx`

- [ ] **Step 1: Read the current HiddenXterm component**

Read `src/components/HiddenXterm.tsx` end-to-end. Note:
- Terminal constructed at line 30 with no `allowProposedApi`
- `attachCustomKeyEventHandler(() => true)` at line 66 — passes all key events through (good)
- Click handler at line 166 calls `xtermRef.current?.focus()`
- No window-level focus/blur listener exists

- [ ] **Step 2: Add window focus/blur listener wired to xterm**

In `HiddenXterm.tsx`, add a new `useEffect` after the existing ResizeObserver effect (after line 112). The effect adds `focus` and `blur` listeners on `window` that call `xtermRef.current?.focus()` / `xtermRef.current?.blur()` so xterm.js emits the focus-event sequences when the app has enabled `?1004`.

```tsx
useEffect(() => {
  const onWindowFocus = () => xtermRef.current?.focus();
  const onWindowBlur = () => xtermRef.current?.blur();
  window.addEventListener('focus', onWindowFocus);
  window.addEventListener('blur', onWindowBlur);
  return () => {
    window.removeEventListener('focus', onWindowFocus);
    window.removeEventListener('blur', onWindowBlur);
  };
}, []);
```

- [ ] **Step 3: Build and smoke-test mouse reporting**

Run `npm run build` and launch the app via `npm run dev` (or whichever dev workflow is in use). In a terminal tab:
1. Run `htop`.
2. Scroll the mouse wheel — verify the process list scrolls.
3. Click a row — verify selection moves.

If mouse events don't reach htop, xterm.js may have moved mouse support behind an addon in 5.5.0. Fix by installing and loading `@xterm/addon-mouse` (if it exists) or `xterm.loadAddon(...)` per xterm.js docs. Re-test.

- [ ] **Step 4: Smoke-test bracketed paste**

In a `bash` (or `zsh`) tab, copy a two-line block to the clipboard:
```
echo first-line
echo second-line
```
Paste into the terminal. Verify:
- Both lines appear on one input line (or the shell shows them as a single pending paste).
- Neither command auto-executes mid-paste.
- The shell must be one that supports bracketed paste (bash ≥ 4, zsh, fish — all default in this repo's tested setups).

- [ ] **Step 5: Smoke-test focus events**

In a terminal tab, run `nvim` and add this to a scratch buffer:
```
:autocmd FocusLost  * echo "lost"
:autocmd FocusGained * echo "gained"
```
Alt-tab to another app, then back. Verify both messages appear in nvim's command line. If focus events don't fire, double-check the window focus/blur listener from Step 2 is installed and that nvim isn't in a mode that suppresses messages.

- [ ] **Step 6: Run the existing test suite**

Run: `npm test`
Expected: all existing tests pass (no new tests in this commit).

- [ ] **Step 7: Commit**

```bash
git add src/components/HiddenXterm.tsx
git commit -m "feat(terminal): wire window focus/blur to xterm for DECSET focus events

Enables ?1004 focus-event reporting for TUIs (nvim, tmux, etc.) by
forwarding window focus/blur into xterm.js. Mouse reporting (?1000/1006)
and bracketed paste (?2004) already work via xterm.js defaults; verified
with htop and multi-line paste."
```

---

# Commit 2: Resize serialization + segmenter barrier

Goal: serialize `pty:resize` so it never races in-flight `pty:data`, and flush the segmenter's partial-line buffer on resize.

### Task 2.1: Create the pure `resizeQueue` module with tests

**Files:**
- Create: `electron/services/resizeQueue.ts`
- Create: `tests/unit/resizeQueue.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/resizeQueue.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { createResizeQueue } from '../../electron/services/resizeQueue';

describe('resizeQueue', () => {
  it('applies a single enqueued resize on next tick', async () => {
    const apply = vi.fn();
    const q = createResizeQueue(apply);
    q.enqueue(80, 24);
    expect(apply).not.toHaveBeenCalled();
    await new Promise(r => setImmediate(r));
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(80, 24);
  });

  it('coalesces rapid enqueues into first + last (last-write-wins)', async () => {
    const apply = vi.fn();
    const q = createResizeQueue(apply);
    q.enqueue(80, 24);
    q.enqueue(100, 30);
    q.enqueue(120, 40);
    // First call drains on the immediate; queue then re-applies the latest pending.
    await new Promise(r => setImmediate(r));
    await new Promise(r => setImmediate(r));
    expect(apply).toHaveBeenCalledTimes(2);
    expect(apply).toHaveBeenNthCalledWith(1, 80, 24);
    expect(apply).toHaveBeenNthCalledWith(2, 120, 40);
  });

  it('settles after the final geometry is applied', async () => {
    const apply = vi.fn();
    const q = createResizeQueue(apply);
    q.enqueue(80, 24);
    q.enqueue(100, 30);
    await new Promise(r => setImmediate(r));
    await new Promise(r => setImmediate(r));
    apply.mockClear();
    await new Promise(r => setImmediate(r));
    expect(apply).not.toHaveBeenCalled();
  });

  it('a new enqueue after settle starts a fresh cycle', async () => {
    const apply = vi.fn();
    const q = createResizeQueue(apply);
    q.enqueue(80, 24);
    await new Promise(r => setImmediate(r));
    q.enqueue(100, 30);
    await new Promise(r => setImmediate(r));
    expect(apply).toHaveBeenCalledTimes(2);
    expect(apply).toHaveBeenNthCalledWith(2, 100, 30);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npm test -- resizeQueue`
Expected: FAIL — `createResizeQueue` not exported (module missing).

- [ ] **Step 3: Implement the module**

Create `electron/services/resizeQueue.ts`:

```ts
export interface ResizeQueue {
  enqueue(cols: number, rows: number): void;
}

type ApplyFn = (cols: number, rows: number) => void;

export function createResizeQueue(apply: ApplyFn): ResizeQueue {
  let pending: { cols: number; rows: number } | null = null;
  let inFlight = false;

  function drain() {
    if (!pending) {
      inFlight = false;
      return;
    }
    const { cols, rows } = pending;
    pending = null;
    apply(cols, rows);
    // Re-check on next tick in case another enqueue arrived during apply.
    setImmediate(drain);
  }

  return {
    enqueue(cols: number, rows: number) {
      pending = { cols, rows };
      if (!inFlight) {
        inFlight = true;
        setImmediate(drain);
      }
    },
  };
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npm test -- resizeQueue`
Expected: PASS (all 4 tests).

- [ ] **Step 5: Commit**

```bash
git add electron/services/resizeQueue.ts tests/unit/resizeQueue.test.ts
git commit -m "feat(pty): add coalescing resize queue"
```

### Task 2.2: Add `onResize()` to BlockSegmenter with tests

**Files:**
- Modify: `src/components/BlockSegmenter.ts`
- Modify: `tests/unit/BlockSegmenter.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/BlockSegmenter.test.ts` (inside the top-level `describe('BlockSegmenter', ...)`):

```ts
describe('onResize', () => {
  it('flushes the partial line buffer as a complete line', () => {
    const seg = new BlockSegmenter();
    // Feed a partial line with no trailing newline.
    seg.feed('partial-without-newline');
    // Sanity: internal state is not directly observable, so we verify
    // behaviorally — after onResize, feeding more text should NOT be
    // appended to the prior partial.
    seg.onResize(80, 24);
    seg.feed('NEXT\n');
    // After flush, the prior partial is its own line; NEXT is its own line.
    // We assert this by feeding a prompt and watching the resulting block.
    const blocks: any[] = [];
    seg.onBlock(b => blocks.push(b));
    // Drive a fake prompt to finalize a block. Use the regex-prompt path
    // (no OSC 133 integration). Format must match PROMPT_RE.
    seg.feed('user@host:~$ ');
    // Now simulate a command + completion to force block emission.
    seg.feed('echo hi\n');
    seg.feed('hi\n');
    seg.feed('user@host:~$ ');
    // The pre-resize partial should appear in the captured output, on its
    // own line (no concatenation with NEXT).
    const allOutput = blocks.map(b => b.output ?? '').join('\n');
    expect(allOutput).toContain('partial-without-newline');
    // And the partial must not be glued to NEXT.
    expect(allOutput).not.toContain('partial-without-newlineNEXT');
  });

  it('is a no-op when there is no partial buffered', () => {
    const seg = new BlockSegmenter();
    expect(() => seg.onResize(100, 30)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npm test -- BlockSegmenter`
Expected: FAIL — `seg.onResize is not a function`.

- [ ] **Step 3: Implement `onResize` in the segmenter**

In `src/components/BlockSegmenter.ts`, add a public method after the existing `reset()` method (around line 625). Insert before the closing class brace:

```ts
  /**
   * Treat a PTY resize as an implicit line boundary: flush any partial
   * line out to pendingLines so subsequent bytes (re-tokenized by xterm.js
   * against the new geometry) don't get glued to pre-resize state.
   */
  onResize(_cols: number, _rows: number): void {
    if (this._partialLine.length > 0 || this._partialRawLine.length > 0) {
      this._pendingLines.push(this._partialLine);
      this._pendingRawLines.push(this._partialRawLine);
      this._partialLine = '';
      this._partialRawLine = '';
    }
  }
```

The `_cols` / `_rows` parameters are accepted for future use (e.g., diagnostic logging) but currently unused.

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npm test -- BlockSegmenter`
Expected: PASS — both new tests, plus all existing 325 lines of segmenter tests still passing.

- [ ] **Step 5: Commit**

```bash
git add src/components/BlockSegmenter.ts tests/unit/BlockSegmenter.test.ts
git commit -m "feat(segmenter): add onResize() to flush partial lines on resize"
```

### Task 2.3: Wire the resize queue into `pty.ts` and emit `pty:resized`

**Files:**
- Modify: `electron/services/pty.ts`
- Modify: `electron/preload.ts`

- [ ] **Step 1: Wire the resize queue per terminal**

In `electron/services/pty.ts`:

1. At the top of the file, add:
   ```ts
   import { createResizeQueue, type ResizeQueue } from './resizeQueue';
   ```

2. Change the per-terminal storage. Currently `allTerminals: Map<number, pty.IPty>`. Replace with a richer entry so we can attach a per-terminal queue:
   ```ts
   interface TerminalEntry {
     term: pty.IPty;
     resizeQueue: ResizeQueue;
   }
   const allTerminals = new Map<number, TerminalEntry>();
   ```

3. Update every read of `allTerminals.get(id)` to use the entry. Specifically:
   - `pty:write` handler (line 168): `allTerminals.get(id)?.term.write(data);`
   - `pty:kill` (line 176-181): pull `entry?.term.kill()`.
   - `pty:getProcess` (line 184-200): `entry?.term`.
   - `pty:getCwd` (line 202-223): `entry?.term`.
   - `pty:isAwaitingInput` (line 225-239): `entry?.term`.
   - `destroyAllTerminals()` (line 395-398): iterate `.term.kill()`.

4. In `pty:create` (around line 112), after constructing `term`:
   ```ts
   const resizeQueue = createResizeQueue((cols, rows) => {
     try { term.resize(cols, rows); } catch {}
     safeSend('pty:resized', id, cols, rows);
   });
   allTerminals.set(id, { term, resizeQueue });
   ```

5. Update the existing `term.onExit` (line 114): `allTerminals.delete(id);` is unchanged.

6. Replace the `pty:resize` handler (line 172-174) with:
   ```ts
   ipcMain.on('pty:resize', (_event, id: number, cols: number, rows: number) => {
     allTerminals.get(id)?.resizeQueue.enqueue(cols, rows);
   });
   ```

- [ ] **Step 2: Expose `onResized` in preload**

In `electron/preload.ts`, inside the `pty:` block (after the existing `onData` at line 15-19), add:

```ts
onResized: (callback: (id: number, cols: number, rows: number) => void) => {
  const listener = (_event: Electron.IpcRendererEvent, id: number, cols: number, rows: number) =>
    callback(id, cols, rows);
  ipcRenderer.on('pty:resized', listener);
  return () => ipcRenderer.removeListener('pty:resized', listener);
},
```

- [ ] **Step 3: Update the TypeScript declaration for `window.tai`**

Find the `window.tai` type declaration (likely in `src/types/` or as a global `.d.ts`). Add `onResized` to the `pty` shape, mirroring `onData`'s signature. If the type is inferred from preload, no change needed.

Run: `find /var/home/mstephens/Documents/GitHub/tai/src -name "*.d.ts" -o -name "global.ts" | head` to locate; or grep for `interface.*pty` or `tai.*pty` in `src/`.

- [ ] **Step 4: Run the build to confirm types compile**

Run: `npm run build`
Expected: PASS — no TS errors. If types fail, fix the declaration.

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: all tests pass (including the new resizeQueue and BlockSegmenter `onResize` tests).

- [ ] **Step 6: Commit**

```bash
git add electron/services/pty.ts electron/preload.ts
# also add the .d.ts file if you modified one
git commit -m "feat(pty): coalesce resize IPC through resizeQueue, emit pty:resized"
```

### Task 2.4: Debounce the ResizeObserver and call `segmenter.onResize()`

**Files:**
- Modify: `src/components/HiddenXterm.tsx`
- Modify: `src/components/TerminalSession.tsx`

- [ ] **Step 1: Debounce the ResizeObserver**

In `src/components/HiddenXterm.tsx`, replace the ResizeObserver effect (lines 97-112) with a 50ms trailing-edge debounce:

```tsx
useEffect(() => {
  if (!containerRef.current) return;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const observer = new ResizeObserver(() => {
    if (!visible) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      try {
        fitRef.current?.fit();
        if (xtermRef.current) {
          window.tai?.pty?.resize(ptyId, xtermRef.current.cols, xtermRef.current.rows);
        }
      } catch { /* ignore */ }
    }, 50);
  });
  observer.observe(containerRef.current);
  return () => {
    observer.disconnect();
    if (timer) clearTimeout(timer);
  };
}, [ptyId, visible]);
```

Also debounce the visibility-fit effect (lines 82-95). Replace the 50ms `setTimeout` (which exists for a different reason — letting layout settle) with the same pattern; in practice the existing 50ms timer is fine — leave it as-is.

- [ ] **Step 2: Subscribe to `pty:resized` in TerminalSession**

In `src/components/TerminalSession.tsx`, find the `useEffect` that subscribes to `pty.onData` (around line 370). Inside the same effect (so cleanup is unified), add:

```tsx
const cleanupResized = window.tai?.pty?.onResized?.((id: number, cols: number, rows: number) => {
  if (cancelled) return;
  if (id !== ptyId) return;
  segmenterRef.current.onResize(cols, rows);
});
```

And in the cleanup function (around line 380-389), add:

```tsx
cleanupResized?.();
```

- [ ] **Step 3: Run the test suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 4: Manual smoke test**

Run the app. In a terminal tab:
1. Run `seq 1 100000 | grep .` (long stream).
2. While output is streaming, drag-resize the window rapidly.
3. Verify:
   - No visible line corruption (no half-lines glued to the wrong text).
   - The segmenter still attributes output to the running command — when you scroll up, the output block is intact and labeled with `seq ...` as the command.

- [ ] **Step 5: Commit**

```bash
git add src/components/HiddenXterm.tsx src/components/TerminalSession.tsx
git commit -m "feat(terminal): debounce resize and flush segmenter partials on resize"
```

---

# Commit 3: Backpressure (coalescing + pause/resume)

Goal: bound the memory used by in-flight PTY output and prevent UI stalls under sustained floods. Two layers: coalescing (always on) and pause/resume (kicks in past 4 MB outstanding).

### Task 3.1: Create the `coalescingBuffer` module with tests

**Files:**
- Create: `electron/services/coalescingBuffer.ts`
- Create: `tests/unit/coalescingBuffer.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/coalescingBuffer.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { createCoalescingBuffer } from '../../electron/services/coalescingBuffer';

describe('coalescingBuffer', () => {
  it('flushes a single push on next tick', async () => {
    const flush = vi.fn();
    const buf = createCoalescingBuffer(flush);
    buf.push('abc');
    expect(flush).not.toHaveBeenCalled();
    await new Promise(r => setImmediate(r));
    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush).toHaveBeenCalledWith('abc');
  });

  it('coalesces multiple pushes within a tick into one flush', async () => {
    const flush = vi.fn();
    const buf = createCoalescingBuffer(flush);
    buf.push('a');
    buf.push('b');
    buf.push('c');
    await new Promise(r => setImmediate(r));
    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush).toHaveBeenCalledWith('abc');
  });

  it('a forceFlush sends synchronously and cancels the scheduled flush', () => {
    const flush = vi.fn();
    const buf = createCoalescingBuffer(flush);
    buf.push('a');
    buf.push('b');
    buf.forceFlush();
    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush).toHaveBeenCalledWith('ab');
  });

  it('forceFlush with empty buffer is a no-op', () => {
    const flush = vi.fn();
    const buf = createCoalescingBuffer(flush);
    buf.forceFlush();
    expect(flush).not.toHaveBeenCalled();
  });

  it('separate tick groups produce separate flushes', async () => {
    const flush = vi.fn();
    const buf = createCoalescingBuffer(flush);
    buf.push('a');
    await new Promise(r => setImmediate(r));
    buf.push('b');
    await new Promise(r => setImmediate(r));
    expect(flush).toHaveBeenCalledTimes(2);
    expect(flush).toHaveBeenNthCalledWith(1, 'a');
    expect(flush).toHaveBeenNthCalledWith(2, 'b');
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npm test -- coalescingBuffer`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the module**

Create `electron/services/coalescingBuffer.ts`:

```ts
type FlushFn = (chunk: string) => void;

export interface CoalescingBuffer {
  push(data: string): void;
  forceFlush(): void;
}

export function createCoalescingBuffer(flush: FlushFn): CoalescingBuffer {
  let pending = '';
  let scheduled = false;

  function doFlush() {
    scheduled = false;
    if (pending.length === 0) return;
    const out = pending;
    pending = '';
    flush(out);
  }

  return {
    push(data: string) {
      pending += data;
      if (!scheduled) {
        scheduled = true;
        setImmediate(doFlush);
      }
    },
    forceFlush() {
      doFlush();
    },
  };
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npm test -- coalescingBuffer`
Expected: PASS (all 5 tests).

- [ ] **Step 5: Commit**

```bash
git add electron/services/coalescingBuffer.ts tests/unit/coalescingBuffer.test.ts
git commit -m "feat(pty): add coalescing buffer for PTY output"
```

### Task 3.2: Create the `backpressureGate` module with tests

**Files:**
- Create: `electron/services/backpressureGate.ts`
- Create: `tests/unit/backpressureGate.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/backpressureGate.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { createBackpressureGate } from '../../electron/services/backpressureGate';

describe('backpressureGate', () => {
  function makeGate(opts?: { high?: number; low?: number }) {
    const pause = vi.fn();
    const resume = vi.fn();
    const gate = createBackpressureGate({
      high: opts?.high ?? 100,
      low: opts?.low ?? 50,
      pause,
      resume,
    });
    return { gate, pause, resume };
  }

  it('does not pause below high-water', () => {
    const { gate, pause } = makeGate();
    gate.onSent(99);
    expect(pause).not.toHaveBeenCalled();
  });

  it('pauses when crossing high-water', () => {
    const { gate, pause } = makeGate();
    gate.onSent(100);
    expect(pause).toHaveBeenCalledTimes(1);
  });

  it('does not pause twice', () => {
    const { gate, pause } = makeGate();
    gate.onSent(120);
    gate.onSent(50);
    expect(pause).toHaveBeenCalledTimes(1);
  });

  it('resumes when ACKs bring outstanding to or below low-water', () => {
    const { gate, pause, resume } = makeGate();
    gate.onSent(120);
    expect(pause).toHaveBeenCalledTimes(1);
    gate.onAck(70); // outstanding = 50, == low
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it('does not resume when still above low-water', () => {
    const { gate, resume } = makeGate();
    gate.onSent(120);
    gate.onAck(20); // outstanding = 100, > low
    expect(resume).not.toHaveBeenCalled();
  });

  it('does not resume when never paused', () => {
    const { gate, resume } = makeGate();
    gate.onSent(40);
    gate.onAck(40);
    expect(resume).not.toHaveBeenCalled();
  });

  it('handles overshoot ACK as zero outstanding (no negative)', () => {
    const { gate, pause, resume } = makeGate();
    gate.onSent(120);
    gate.onAck(1000);
    expect(resume).toHaveBeenCalledTimes(1);
    // Subsequent sends start fresh at 0.
    gate.onSent(99);
    expect(pause).toHaveBeenCalledTimes(1); // not called again
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npm test -- backpressureGate`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the module**

Create `electron/services/backpressureGate.ts`:

```ts
export interface BackpressureGateOptions {
  high: number;
  low: number;
  pause: () => void;
  resume: () => void;
}

export interface BackpressureGate {
  onSent(bytes: number): void;
  onAck(bytes: number): void;
}

export function createBackpressureGate(opts: BackpressureGateOptions): BackpressureGate {
  let outstanding = 0;
  let paused = false;

  return {
    onSent(bytes: number) {
      outstanding += bytes;
      if (!paused && outstanding >= opts.high) {
        paused = true;
        opts.pause();
      }
    },
    onAck(bytes: number) {
      outstanding -= bytes;
      if (outstanding < 0) outstanding = 0;
      if (paused && outstanding <= opts.low) {
        paused = false;
        opts.resume();
      }
    },
  };
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npm test -- backpressureGate`
Expected: PASS (all 7 tests).

- [ ] **Step 5: Commit**

```bash
git add electron/services/backpressureGate.ts tests/unit/backpressureGate.test.ts
git commit -m "feat(pty): add backpressure gate with high/low-water hysteresis"
```

### Task 3.3: Wire coalescing + backpressure into `pty.ts`

**Files:**
- Modify: `electron/services/pty.ts`
- Modify: `electron/preload.ts`

- [ ] **Step 1: Wire the modules in pty.ts**

In `electron/services/pty.ts`:

1. Add imports at the top:
   ```ts
   import { createCoalescingBuffer, type CoalescingBuffer } from './coalescingBuffer';
   import { createBackpressureGate, type BackpressureGate } from './backpressureGate';
   ```

2. Define thresholds as module-level constants:
   ```ts
   const BACKPRESSURE_HIGH = 4 * 1024 * 1024;
   const BACKPRESSURE_LOW = 1 * 1024 * 1024;
   ```

3. Extend `TerminalEntry`:
   ```ts
   interface TerminalEntry {
     term: pty.IPty;
     resizeQueue: ResizeQueue;
     buffer: CoalescingBuffer;
     gate: BackpressureGate;
   }
   ```

4. In `pty:create`, after constructing `term` and `resizeQueue`, build the buffer and gate:
   ```ts
   const gate = createBackpressureGate({
     high: BACKPRESSURE_HIGH,
     low: BACKPRESSURE_LOW,
     pause: () => { try { term.pause(); } catch {} },
     resume: () => { try { term.resume(); } catch {} },
   });
   const buffer = createCoalescingBuffer((chunk) => {
     safeSend('pty:data', id, chunk);
     gate.onSent(chunk.length);
   });
   allTerminals.set(id, { term, resizeQueue, buffer, gate });
   ```

5. Replace the existing `term.onData` (line 132-135) with:
   ```ts
   term.onData((data) => {
     lastDataAt = Date.now();
     buffer.push(data);
   });
   ```

6. Update the `resizeQueue` factory's apply function (from Task 2.3 step 1) to force-flush the buffer *before* applying the resize. The buffer reference is captured in a closure, so re-arrange so that `buffer` is declared before `resizeQueue`, or use a forward reference via mutable variable:
   ```ts
   let buffer: CoalescingBuffer;
   const resizeQueue = createResizeQueue((cols, rows) => {
     buffer?.forceFlush();
     try { term.resize(cols, rows); } catch {}
     safeSend('pty:resized', id, cols, rows);
   });
   // ...
   buffer = createCoalescingBuffer(...);
   ```
   (Adjust the Task 2.3 wiring as needed to match.)

7. Add the `pty:data-ack` IPC handler somewhere with the other handlers:
   ```ts
   ipcMain.on('pty:data-ack', (_event, id: number, bytes: number) => {
     allTerminals.get(id)?.gate.onAck(bytes);
   });
   ```

8. In `pty:kill` (and in `destroyAllTerminals`), force-flush before kill so the last bytes reach the renderer:
   ```ts
   entry.buffer.forceFlush();
   entry.term.kill();
   ```

- [ ] **Step 2: Expose `dataAck` in preload**

In `electron/preload.ts`, add inside the `pty:` block:

```ts
dataAck: (id: number, bytes: number) => ipcRenderer.send('pty:data-ack', id, bytes),
```

- [ ] **Step 3: Update the `window.tai.pty` type declaration**

Add `dataAck: (id: number, bytes: number) => void` to the type declaration alongside `resize`, `kill`, etc. (Same file you touched in Task 2.3 Step 3, if any.)

- [ ] **Step 4: Build to confirm types compile**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 5: Run the test suite**

Run: `npm test`
Expected: PASS — all 17+ tests (new modules + existing).

- [ ] **Step 6: Commit**

```bash
git add electron/services/pty.ts electron/preload.ts
# include .d.ts if modified
git commit -m "feat(pty): coalesce PTY output and apply backpressure to renderer"
```

### Task 3.4: Send ACKs from the renderer after xterm.js parses each chunk

**Files:**
- Modify: `src/components/HiddenXterm.tsx`

- [ ] **Step 1: Add ACK emission to the imperative `write` method**

In `src/components/HiddenXterm.tsx`, the `useImperativeHandle` exposes `write(data)` which currently calls `xtermRef.current?.write(data); onData?.(data);` (lines 115-118).

`xterm.write` accepts an optional callback that fires after parsing completes. Use it to drive the ACK. To avoid one IPC-send per chunk, batch via `setTimeout(0)`:

Replace lines 114-146 (the `useImperativeHandle` block) with a version that introduces a ref-scoped ACK batch:

```tsx
const pendingAckRef = useRef(0);
const ackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

const scheduleAck = () => {
  if (ackTimerRef.current) return;
  ackTimerRef.current = setTimeout(() => {
    ackTimerRef.current = null;
    const n = pendingAckRef.current;
    pendingAckRef.current = 0;
    if (n > 0) window.tai?.pty?.dataAck?.(ptyId, n);
  }, 0);
};

useImperativeHandle(ref, () => ({
  write(data: string) {
    const term = xtermRef.current;
    if (!term) {
      onData?.(data);
      return;
    }
    term.write(data, () => {
      pendingAckRef.current += data.length;
      scheduleAck();
    });
    onData?.(data);
  },
  sendInput(data: string) {
    window.tai?.pty?.write(ptyId, data);
  },
  getTerminal() {
    return xtermRef.current;
  },
  focus() {
    xtermRef.current?.focus();
  },
  clear() {
    xtermRef.current?.clear();
  },
  getBufferContent() {
    const term = xtermRef.current;
    if (!term) return '';
    const buf = term.buffer.active;
    const lines: string[] = [];
    for (let i = 0; i < buf.length; i++) {
      const line = buf.getLine(i);
      if (line) lines.push(line.translateToString(true));
    }
    let end = lines.length;
    while (end > 0 && lines[end - 1].trim() === '') end--;
    let start = 0;
    while (start < end && lines[start].trim() === '') start++;
    return lines.slice(start, end).join('\n');
  },
}), [ptyId, onData]);

useEffect(() => {
  return () => {
    if (ackTimerRef.current) clearTimeout(ackTimerRef.current);
  };
}, []);
```

Note: `data.length` is the JS string length (UTF-16 code units). The main-process counter `onSent` is also fed `chunk.length` from the JS string, so the two match.

- [ ] **Step 2: Run the test suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 3: Manual smoke test — flood**

Run the app. In a terminal tab:
1. Run `yes | head -c 100M` (Unix) or equivalent flood on Windows.
2. Observe:
   - The UI remains responsive (typing in other tabs is not blocked).
   - Main-process RSS does not grow unbounded (check via `ps`/Task Manager during the flood — should stabilize, not climb linearly past ~50 MB above baseline).
3. After completion, the prompt returns; subsequent commands work normally.

- [ ] **Step 4: Manual smoke test — large file**

Run `cat /path/to/large-50MB-file` (any 10 MB+ text or log). Verify:
- Completes without UI stall.
- Output is intact and scrolls correctly.

- [ ] **Step 5: Manual smoke test — combined with resize**

Run `seq 1 1000000`, drag-resize during stream. Verify no UI freeze and segmenter integrity holds (combination of commit 2 + 3 behavior).

- [ ] **Step 6: Commit**

```bash
git add src/components/HiddenXterm.tsx
git commit -m "feat(terminal): ack PTY chunks after xterm parse to drive backpressure"
```

---

# Final: PR and release

### Task F.1: Verify and open PR

- [ ] **Step 1: Final test suite run**

Run: `npm test`
Expected: PASS — all tests including the three new module tests and the new BlockSegmenter `onResize` describe.

- [ ] **Step 2: Final build**

Run: `npm run build`
Expected: PASS — no TS errors.

- [ ] **Step 3: Confirm commit graph**

Run: `git log --oneline master..HEAD`
Expected: 7 commits in this order (roughly):
1. `feat(terminal): wire window focus/blur to xterm for DECSET focus events`
2. `feat(pty): add coalescing resize queue`
3. `feat(segmenter): add onResize() to flush partial lines on resize`
4. `feat(pty): coalesce resize IPC through resizeQueue, emit pty:resized`
5. `feat(terminal): debounce resize and flush segmenter partials on resize`
6. `feat(pty): add coalescing buffer for PTY output`
7. `feat(pty): add backpressure gate with high/low-water hysteresis`
8. `feat(pty): coalesce PTY output and apply backpressure to renderer`
9. `feat(terminal): ack PTY chunks after xterm parse to drive backpressure`

(That's 9, not 7 — three logical commits each broke into multiple steps. That's fine; the PR description groups them.)

- [ ] **Step 4: Push the branch**

```bash
git push -u origin <branch-name>
```

- [ ] **Step 5: Open a PR**

Use the commit-commands or `gh pr create`. The PR description should reference the design spec at `docs/superpowers/specs/2026-05-16-terminal-pipeline-hardening-design.md` and group commits into the three logical changes: DECSET, resize serialization, backpressure.

- [ ] **Step 6: Cut a release after merge**

Once merged, use the `/release` skill (this repo's release flow) to publish.

---

## Self-Review

**Spec coverage:**
- Commit 1 DECSET → Task 1.1 (✓ all spec items: mouse, paste, focus wiring)
- Commit 2 resize → Tasks 2.1 (resizeQueue), 2.2 (segmenter onResize), 2.3 (pty.ts wiring + pty:resized), 2.4 (debounce + subscribe) (✓ all spec items)
- Commit 3 backpressure → Tasks 3.1 (coalescing), 3.2 (gate), 3.3 (pty.ts wiring), 3.4 (renderer ACK) (✓ all spec items)
- Spec's regression contract (existing 325 lines of `BlockSegmenter.test.ts` pass unchanged) → enforced by `npm test` step in Tasks 2.2, 2.3, 2.4, 3.3, 3.4 and final step.

**Placeholder scan:** No "TBD", "implement later", or hand-wavy steps. Every code block is concrete.

**Type consistency:**
- `TerminalEntry` introduced in Task 2.3 step 1, extended in Task 3.3 step 1 — consistent shape.
- `createResizeQueue` / `createCoalescingBuffer` / `createBackpressureGate` factory names consistent across plan and tests.
- `forceFlush` named identically in module, tests, and wiring.
- `onResize(cols, rows)` matches between segmenter implementation and TerminalSession subscriber.
- IPC channel names: `pty:resized` (main → renderer), `pty:data-ack` (renderer → main) — used consistently.

**Known sequencing note:** Task 2.3 wires the resize queue with a closure that does *not* yet reference `buffer`. Task 3.3 step 1 #6 rewrites that closure to add `buffer?.forceFlush()` and notes the forward-reference dance. This is intentional — commit 2 is testable without commit 3 having landed. The minor refactor of moving variable declarations in commit 3 is explicit.
