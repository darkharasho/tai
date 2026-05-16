# Terminal Pipeline Hardening — Design

**Date:** 2026-05-16
**Status:** Approved, ready for implementation planning
**Author:** brainstormed with Claude

## Summary

Harden TAI's PTY → renderer pipeline against three classes of bug that mature terminal emulators (kitty, wezterm, iTerm2, VTE, Ghostty) already handle:

1. **Missing terminal protocol modes** — TUI apps can't use mouse, bracketed paste, or focus events.
2. **Resize races** — `pty:resize` IPC fires concurrently with in-flight `pty:data`, producing line-wrap artifacts and confusing the OSC 133 segmenter.
3. **No PTY backpressure** — a flood (`yes`, runaway log) can pile unbounded IPC messages between main and renderer, causing memory bloat and UI stalls.

Recent work has hardened OSC 133 segmentation; these three address the surrounding pipeline.

## Shipping plan

One branch, three commits, one PR, one release. Each commit is independently reviewable; they ship together because none is individually demo-able.

**Commit order:**
1. DECSET modes — smallest, lowest blast radius
2. Resize serialization + segmenter barrier — builds the flush primitive
3. Backpressure (coalescing + pause/resume) — reuses the flush primitive

## Scope

**In scope:**
- `electron/services/pty.ts`
- `electron/preload.ts` (new IPC channels)
- `src/components/HiddenXterm.tsx`
- `src/components/BlockSegmenter.ts`
- New tests under `tests/unit/`

**Out of scope:**
- OSC 52 clipboard (security trade-off; needs its own design)
- xterm.js renderer choice (canvas vs. webgl)
- SIGHUP-on-close, locale/TERM, WM_CLASS, shell-integration injection timing (separate items from the audit)
- Anything outside the PTY data path

---

## Commit 1 — DECSET modes

### Goal
Enable mouse reporting, bracketed paste, and focus events for TUI applications.

### Files touched
- `src/components/HiddenXterm.tsx` only

### Design

xterm.js core (5.5.0) already honors `?1000/1002/1003/1006` (mouse), `?2004` (bracketed paste), and `?1004` (focus events) when the application enables them via DECSET. Our role is to (a) confirm nothing in our code intercepts the relevant events before xterm.js sees them, and (b) wire window focus/blur to xterm focus/blur so xterm emits the `CSI I` / `CSI O` sequences correctly.

**Changes:**
1. Verify (with a quick xterm.js smoke run) that mouse, bracketed paste, and focus modes activate automatically when DECSET is received. If any one requires an addon in 5.5.0, install it.
2. Audit `attachCustomKeyEventHandler(() => true)` in `HiddenXterm.tsx:66` — currently passes all events through, which is fine. Confirm it doesn't accidentally swallow paste shortcuts.
3. Add a window-level focus/blur listener in `HiddenXterm.tsx` that calls `xterm.focus()` / `xterm.blur()` (xterm.js will emit `CSI I`/`CSI O` to the PTY when focus mode is enabled by the running app).

### Risk
Low. Mostly verification.

### Manual test plan
- `htop`: mouse wheel scrolls through processes.
- `printf '%s\n' 'echo a' 'echo b' | xclip -selection clipboard` then paste into bash — both lines arrive as one chunk; nothing auto-executes mid-paste.
- `nvim`, alt-tab away and back — focus events received (verified via debug log or `autocmd FocusGained`).

### Unit tests
None. Configuration + window listener; not meaningfully unit-testable.

---

## Commit 2 — Resize serialization + segmenter barrier

### Goal
Eliminate the race between `pty:resize` and in-flight `pty:data` that produces line-wrap artifacts and confuses the segmenter's partial-line buffer.

### Files touched
- `src/components/HiddenXterm.tsx` — debounce ResizeObserver
- `electron/services/pty.ts` — resize queue, flush-before-resize
- `electron/preload.ts` — new `pty:resized` event (main → renderer)
- `src/components/BlockSegmenter.ts` — new `onResize()` method
- `src/components/TerminalSession.tsx` — owner of the segmenter (`TerminalSession.tsx:111`); subscribes to `pty:resized`

### The race
`ResizeObserver` (`HiddenXterm.tsx:99`) fires `pty:resize` per observation. In main, `pty.resize()` runs synchronously. Concurrently, `term.onData` may still be emitting bytes tokenized against the *old* geometry. xterm.js applies new geometry to the renderer side, but the in-flight bytes land in cells assuming the old width. The segmenter's `_partialLine` buffer then carries that ambiguous state across the resize boundary.

### Design

**1. Debounce in renderer (`HiddenXterm.tsx`):**
- Replace the bare `requestAnimationFrame` in the ResizeObserver callback (line 101) with a 50ms trailing-edge debounce.
- Same debounce around the visibility-change fit (line 84).
- Collapses drag-resize from ~60 IPC calls/sec to ~1 per pause.

**2. Resize queue + flush in main (`pty.ts`):**

Per-terminal state:
- `pendingResize: {cols, rows} | null`
- `resizeInFlight: boolean`

Flow on `pty:resize`:
- If `resizeInFlight`: overwrite `pendingResize` (last-write-wins; only final geometry matters).
- Else: set `resizeInFlight = true`, then `setImmediate(() => applyResize())`. The deferral lets any libuv-queued `onData` callbacks drain first.
- `applyResize()`: flush the coalescing buffer (introduced in commit 3, but as a no-op stub for commit 2), call `term.resize(cols, rows)`, emit `pty:resized` IPC with applied geometry. Then check `pendingResize`: if non-null, take it and reschedule; else clear the in-flight flag.

For commit 2 alone, "flush the coalescing buffer" is a stub that just sends any pending bytes immediately — same behavior as today. Commit 3 swaps in the real coalescing buffer.

**3. Segmenter `onResize` hook (`BlockSegmenter.ts`):**

New public method:
```ts
onResize(cols: number, rows: number): void
```
- Flushes `_partialLine` to `_pendingLines` (and `_partialRawLine` to `_pendingRawLines`) as if a newline arrived. Treats the resize as an implicit line boundary.
- Does *not* touch `_pendingLines` proper — those are complete lines already correctly attributed.

`TerminalSession.tsx` (segmenter owner, line 111) subscribes via `window.tai.pty.onResized(id, cb)` and calls `segmenter.onResize(cols, rows)` **after** xterm.js has re-fit and **before** processing the next `pty:data`. Ordering is naturally guaranteed because both `pty:resized` and `pty:data` arrive on the same IPC channel in order.

### Tradeoff
A long line in flight at resize time may appear split across two visual lines instead of one. Acceptable: preferable to mis-attribution to the wrong subsequent command.

### Manual test plan
- `seq 1 100000 | grep .` running in TAI; drag-resize the window mid-stream.
- Verify no visible line corruption; segmenter still attributes output to the running command (no split blocks).

### Unit tests
- `tests/unit/BlockSegmenter.test.ts`: new `describe('onResize')` — feed partial line, call `onResize(80, 24)`, feed next chunk; assert the partial flushed as its own line and the new chunk started fresh.
- `tests/unit/resizeQueue.test.ts` (new file): extract the resize queue logic from `pty.ts` into `createResizeQueue(applyFn)`. Test that rapid `enqueue(a); enqueue(b); enqueue(c)` produces exactly two `applyFn` calls — `a` and `c`.

---

## Commit 3 — Backpressure: coalescing + pause/resume

### Goal
Bound the memory used by in-flight PTY output and prevent UI stalls under sustained floods.

### Files touched
- `electron/services/pty.ts` — coalescing buffer + backpressure gate
- `electron/preload.ts` — new `pty:data-ack` event (renderer → main)
- `src/components/HiddenXterm.tsx` — batched ACK emission from the `xterm.write` completion callback

### Two layers, per-terminal

#### Layer A — Coalescing buffer (always on)

Replaces the direct `safeSend('pty:data', id, data)` at `pty.ts:134`.

Per-terminal state:
- `pendingBuf: string`
- `flushScheduled: boolean`

On `term.onData(data)`:
- Append to `pendingBuf`.
- If not scheduled: `setImmediate(flush)`, set `flushScheduled = true`.

`flush()`:
- `safeSend('pty:data', id, pendingBuf)` (single IPC message).
- `outstandingBytes += pendingBuf.length` (see Layer B).
- Clear `pendingBuf`, clear `flushScheduled`.

**Force-flush triggers:**
- Before applying a resize (composes with commit 2's `applyResize`).
- On terminal close (partial graceful-drain — full drain is a separate concern).

**Effect:** bursty output (`npm install`, log spew) collapses into one IPC message per event-loop tick. Renderer parses once. Wire format unchanged.

#### Layer B — Backpressure gate

Per-terminal state:
- `outstandingBytes: number`
- `paused: boolean`

Thresholds:
- `HIGH_WATER = 4 * 1024 * 1024` (4 MB) — normal command output never hits this.
- `LOW_WATER = 1 * 1024 * 1024` (1 MB) — hysteresis to prevent oscillation.

Flow:
- On flush: if `outstandingBytes >= HIGH_WATER && !paused`, call `term.pause()`; set `paused = true`.
- New IPC channel `pty:data-ack` from renderer → main, payload `(id, bytesProcessed)`.
- Renderer batches ACKs: on every received `pty:data`, schedule `setTimeout(() => ack(totalSinceLastAck), 0)`. Don't ACK per chunk.
- On ACK: `outstandingBytes -= bytesProcessed`. If `paused && outstandingBytes <= LOW_WATER`, call `term.resume()`; clear `paused`.

**xterm.js write completion as ACK trigger:**
`xterm.write(data, callback)` invokes the callback after xterm.js finishes parsing. Use this for the ACK rather than IPC arrival — gives true end-to-end backpressure. Renderer code:
```ts
xterm.write(chunk, () => {
  pendingAck += chunk.length;
  scheduleAck();
});
```
`scheduleAck` debounces via `setTimeout(0)` so multiple writes within a tick produce a single ACK.

### Edge cases
- Renderer crashes / window closes mid-flood: ACKs stop, PTY stays paused, then `destroyAllTerminals()` kills it. Acceptable — terminal is being torn down.
- `node-pty` pause/resume support: confirmed on both Unix (native fd reader pause) and Windows ConPTY.

### Manual test plan
- `yes | head -c 100M` in TAI: main-process memory bounded (target: < 20 MB peak per terminal), UI stays responsive.
- `cat large-file.log` (~50 MB): completes without UI stall.
- Verify pause/resume fires via debug log under flood.

### Unit tests
Refactor for testability:
- `createCoalescingBuffer(flushFn)`: rapid pushes within one tick → single flush call with concatenated payload.
- `createBackpressureGate({ high, low, pause, resume })`: crossing high-water calls `pause`; ACKs below low-water call `resume`; ACKs that don't cross low-water do not call `resume`; spurious double-ACKs are idempotent.

Files: `tests/unit/coalescingBuffer.test.ts`, `tests/unit/backpressureGate.test.ts`.

---

## Test plan summary

| Commit | Unit tests | Manual smoke |
|---|---|---|
| 1 DECSET | none | htop mouse, multi-line paste, nvim focus |
| 2 Resize | `BlockSegmenter.test.ts` (new `onResize` describe), `resizeQueue.test.ts` (new) | `seq` + drag-resize, segmenter integrity |
| 3 Backpressure | `coalescingBuffer.test.ts` (new), `backpressureGate.test.ts` (new) | `yes \| head -c 100M`, large `cat` |

**Regression contract:** all 325 lines of existing `BlockSegmenter.test.ts` continue to pass unchanged after commits 2 and 3.

CI: Vitest config already in place; no new tooling.

## Open questions

None at design time. If xterm.js 5.5.0 requires an addon for any of the DECSET modes (commit 1), install it and note in the PR.

## Future work (explicitly deferred)

- OSC 52 clipboard (security trade-off, opt-in toggle)
- SIGHUP on close (audit item #5)
- Locale/TERM auto-detection (audit item #7)
- WM_CLASS / window-role hints (audit item #8)
- Shell-integration injection timing improvements (audit item #6)
