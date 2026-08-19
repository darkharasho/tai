# Terminal Authority Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make TAI's terminal decide "who owns the input right now" from authoritative signals (kernel termios, shell hooks, alt-screen escapes) instead of racing three independent byte-sniffing heuristics, and build a PTY record/replay corpus so these bugs stop being unreproducible.

**Architecture:** A new pure reducer, `src/utils/terminalMode.ts`, becomes the single decider. It consumes tagged `ModeSignal`s from every source and emits one `ModeState` carrying both the decision and its `provenance` (how we know). `BlockSegmenter` stops owning mode state — it *emits* signals and *reads* state. Retention is decoupled from rendering: bytes are only dropped when an authoritative signal says so, otherwise they go to a bounded side buffer that can be replayed if the guess turns out wrong. A recorder captures raw PTY bytes interleaved with termios events, and a replay harness drives both the segmenter and the resolver from those recordings in tests.

**Tech Stack:** TypeScript (strict), React 18, Electron (main/renderer split), Vitest, xterm.js, node-pty, node-termios.

**Spec:** `docs/superpowers/specs/2026-08-19-terminal-authority-migration-design.md` (commits `289cb3a`, `f2b6eb4` on branch `terminal-authority-migration`)

## Global Constraints

- **Branch:** all work lands on `terminal-authority-migration`. Do not commit to `master`.
- **Test command:** `npm test` (which is `vitest run --config tests/vitest.config.ts`). The config at `tests/vitest.config.ts` already pins `pool: 'forks'`, `maxForks: 2`, `maxWorkers: 2` — respect it, do not raise it, and do not invoke bare `vitest`.
- **Single-test runs:** `npx vitest run --config tests/vitest.config.ts <path> -t "<name>"`.
- **Typecheck:** `npx tsc --noEmit` must pass before every commit.
- **Baseline:** the full suite is green before this plan starts. Every task ends green. If a task's change *intentionally* alters existing behaviour, the task updates the affected existing test in the same commit and says so in the commit message.
- **No shell integration script changes.** `electron/shell-integration/tai-zsh.zsh`, `tai-bash.sh`, and `tai-fish.fish` are not touched by any task. This is what keeps the hard real-zsh verification gate from the ZDOTDIR work from re-triggering.
- **Import alias:** renderer code imports via `@/` (e.g. `@/utils/terminalMode`). `@` maps to `src/`. Electron main-process code (`electron/**`) uses relative imports — it does not have the alias.
- **Test environment is `node`**, not `jsdom`. Pure-module tests are the default; component tests that need DOM must set `// @vitest-environment jsdom` at the top of the file (see `tests/unit/BlockListBehavior.test.tsx` for the existing pattern).
- **Commit style:** conventional commits (`feat:`, `fix:`, `test:`, `refactor:`, `docs:`, `chore:`). End every commit message with:
  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  ```

## Naming Contract

These names are used across tasks. Later tasks depend on them being exactly right.

| Name | Defined in | Task |
|---|---|---|
| `PtyRecordingEntry`, `PtyRecording` | `src/utils/ptyRecording.ts` | 1 |
| `PtyRecorder` (`.data()`, `.termios()`, `.exit()`, `.serialize()`, `.clear()`) | `src/utils/ptyRecording.ts` | 1 |
| `parseRecording(jsonl: string): PtyRecording` | `src/utils/ptyRecording.ts` | 1 |
| `replayRecording(rec, opts?): ReplayResult` | `tests/helpers/replayPty.ts` | 3 |
| `ModeSignal`, `ModeState`, `ModeResolver` | `src/utils/terminalMode.ts` | 6 |
| `createModeResolver(): ModeResolver` | `src/utils/terminalMode.ts` | 6 |
| `segmenter.onModeSignal(cb)` | `src/components/BlockSegmenter.ts` | 6 |
| `segmenter.setModeState(state)` | `src/components/BlockSegmenter.ts` | 9 |

---

## Task 1: PTY recording format and ring buffer

The recording format is the foundation of the whole corpus. It has two hard requirements that drive its shape: **chunk boundaries must be preserved** (`_altScreenTail = rawData.slice(-7)` in `BlockSegmenter.ts:684` exists only because escape sequences split across chunks — a replay that re-chunks cannot reproduce those bugs), and **out-of-band termios events must be interleaved in real time order** (after this migration, mode resolution depends on when termios transitions arrive relative to bytes).

Base64 for the payload because PTY output is not guaranteed valid UTF-8 — that is why `src/utils/sanitizeSurrogates.ts` exists.

**Files:**
- Create: `src/utils/ptyRecording.ts`
- Test: `tests/unit/ptyRecording.test.ts`

**Interfaces:**
- Consumes: nothing (leaf module).
- Produces:
  ```ts
  export type PtyRecordingEntry =
    | { t: number; kind: 'data'; d: string }                                  // d = base64
    | { t: number; kind: 'termios'; icanon: boolean; echo: boolean }
    | { t: number; kind: 'resize'; cols: number; rows: number }
    | { t: number; kind: 'exit'; code: number };

  export interface PtyRecording {
    entries: PtyRecordingEntry[];
  }

  export const RECORDING_RING_BYTES: number;         // 1024 * 1024

  export class PtyRecorder {
    constructor(now?: () => number, maxBytes?: number);
    data(chunk: string): void;
    termios(icanon: boolean, echo: boolean): void;
    resize(cols: number, rows: number): void;
    exit(code: number): void;
    serialize(): string;                              // JSONL, one entry per line
    clear(): void;
    get byteLength(): number;
  }

  export function parseRecording(jsonl: string): PtyRecording;
  ```

**Notes for the implementer:**
- `t` is milliseconds since the recorder was constructed. The `now` constructor param exists so tests can inject a fake clock — default it to `() => Date.now()`.
- The ring evicts **whole entries from the front** when `byteLength` exceeds `maxBytes`. Never truncate an entry's payload: a half-decoded escape sequence would produce a recording that replays into garbage, which is worse than a shorter recording.
- `byteLength` counts the byte length of the decoded `data` payloads only (`Buffer.byteLength(chunk, 'utf8')`), not the JSON overhead. It is a budget for terminal output, not for file size.
- Do **not** evict so aggressively that the recording starts mid-escape-sequence in a way you can detect and fix — you cannot detect it. Accept that a ring-buffer recording may begin mid-stream; that is inherent, and replay tests start from a fresh segmenter which handles arbitrary starting bytes already.
- Base64 encode with `Buffer.from(chunk, 'utf8').toString('base64')` and decode with `Buffer.from(d, 'base64').toString('utf8')`. Node's `Buffer` is available (test environment is `node`, and the renderer runs with `nodeIntegration` through the preload bridge — but this module is only used for recording/replay, never in a hot render path).
- `parseRecording` skips blank lines and throws `Error('malformed recording line: <line>')` on a line that is not valid JSON or lacks a known `kind`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/ptyRecording.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { PtyRecorder, parseRecording, RECORDING_RING_BYTES } from '@/utils/ptyRecording';

function fakeClock() {
  let t = 0;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

describe('PtyRecorder', () => {
  it('records data, termios and exit entries with relative timestamps', () => {
    const clock = fakeClock();
    const rec = new PtyRecorder(clock.now);

    rec.data('hello');
    clock.advance(214);
    rec.termios(false, true);
    clock.advance(417);
    rec.data('world');
    clock.advance(549);
    rec.exit(0);

    const parsed = parseRecording(rec.serialize());
    expect(parsed.entries).toEqual([
      { t: 0,    kind: 'data',    d: Buffer.from('hello', 'utf8').toString('base64') },
      { t: 214,  kind: 'termios', icanon: false, echo: true },
      { t: 631,  kind: 'data',    d: Buffer.from('world', 'utf8').toString('base64') },
      { t: 1180, kind: 'exit',    code: 0 },
    ]);
  });

  it('preserves chunk boundaries exactly rather than concatenating', () => {
    const rec = new PtyRecorder(() => 0);
    rec.data('\x1b[?');
    rec.data('1049h');

    const parsed = parseRecording(rec.serialize());
    const datas = parsed.entries.filter(e => e.kind === 'data') as Array<{ d: string }>;
    expect(datas).toHaveLength(2);
    expect(Buffer.from(datas[0].d, 'base64').toString('utf8')).toBe('\x1b[?');
    expect(Buffer.from(datas[1].d, 'base64').toString('utf8')).toBe('1049h');
  });

  it('round-trips non-UTF8-safe bytes through base64', () => {
    const rec = new PtyRecorder(() => 0);
    const weird = '\x1b[31mÿ█ café 😀';
    rec.data(weird);

    const parsed = parseRecording(rec.serialize());
    const entry = parsed.entries[0] as { d: string };
    expect(Buffer.from(entry.d, 'base64').toString('utf8')).toBe(weird);
  });

  it('evicts whole entries from the front when over the byte budget', () => {
    const rec = new PtyRecorder(() => 0, 100);
    rec.data('a'.repeat(60));
    rec.data('b'.repeat(60));

    const parsed = parseRecording(rec.serialize());
    // First entry evicted whole; the survivor is intact, never truncated.
    expect(parsed.entries).toHaveLength(1);
    const entry = parsed.entries[0] as { d: string };
    expect(Buffer.from(entry.d, 'base64').toString('utf8')).toBe('b'.repeat(60));
    expect(rec.byteLength).toBe(60);
  });

  it('never truncates an entry payload to fit the budget', () => {
    const rec = new PtyRecorder(() => 0, 10);
    rec.data('c'.repeat(50));

    const parsed = parseRecording(rec.serialize());
    const entry = parsed.entries[0] as { d: string };
    // A single oversized chunk is kept whole rather than sliced into garbage.
    expect(Buffer.from(entry.d, 'base64').toString('utf8')).toBe('c'.repeat(50));
  });

  it('clear() empties the ring and resets the byte count', () => {
    const rec = new PtyRecorder(() => 0);
    rec.data('x');
    rec.clear();
    expect(rec.byteLength).toBe(0);
    expect(parseRecording(rec.serialize()).entries).toEqual([]);
  });

  it('defaults the ring budget to 1MB', () => {
    expect(RECORDING_RING_BYTES).toBe(1024 * 1024);
  });
});

describe('parseRecording', () => {
  it('skips blank lines', () => {
    const jsonl = '{"t":0,"kind":"data","d":"aGk="}\n\n\n';
    expect(parseRecording(jsonl).entries).toHaveLength(1);
  });

  it('throws on a malformed line', () => {
    expect(() => parseRecording('not json')).toThrow(/malformed recording line/);
  });

  it('throws on an unknown entry kind', () => {
    expect(() => parseRecording('{"t":0,"kind":"nope"}')).toThrow(/malformed recording line/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config tests/vitest.config.ts tests/unit/ptyRecording.test.ts`
Expected: FAIL — `Failed to resolve import "@/utils/ptyRecording"`.

- [ ] **Step 3: Write the implementation**

Create `src/utils/ptyRecording.ts`:

```ts
/**
 * PTY session recording: raw byte chunks interleaved with the out-of-band
 * events (termios transitions, resizes, exit) that mode resolution depends on.
 *
 * Two properties are load-bearing and must not be "optimized" away:
 *
 *  1. Chunk boundaries are preserved verbatim. BlockSegmenter carries
 *     `_altScreenTail` precisely because escape sequences split across chunk
 *     boundaries; a recording that concatenates or re-chunks cannot reproduce
 *     that class of bug, which is most of why it exists.
 *  2. Out-of-band events are interleaved in arrival order. After the authority
 *     migration, whether termios arrives before or after a given chunk changes
 *     the resolved mode — a data-only recording cannot replay the decision.
 *
 * Payloads are base64 because PTY output is not guaranteed valid UTF-8 (the
 * same reason `sanitizeSurrogates.ts` exists).
 */

export type PtyRecordingEntry =
  | { t: number; kind: 'data'; d: string }
  | { t: number; kind: 'termios'; icanon: boolean; echo: boolean }
  | { t: number; kind: 'resize'; cols: number; rows: number }
  | { t: number; kind: 'exit'; code: number };

export interface PtyRecording {
  entries: PtyRecordingEntry[];
}

/** Per-pty ring budget, counted over decoded data payloads only. */
export const RECORDING_RING_BYTES = 1024 * 1024;

export class PtyRecorder {
  private _entries: PtyRecordingEntry[] = [];
  private _bytes = 0;
  private _start: number;

  constructor(
    private _now: () => number = () => Date.now(),
    private _maxBytes: number = RECORDING_RING_BYTES,
  ) {
    this._start = this._now();
  }

  get byteLength(): number { return this._bytes; }

  data(chunk: string): void {
    const size = Buffer.byteLength(chunk, 'utf8');
    this._push({ t: this._t(), kind: 'data', d: Buffer.from(chunk, 'utf8').toString('base64') }, size);
  }

  termios(icanon: boolean, echo: boolean): void {
    this._push({ t: this._t(), kind: 'termios', icanon, echo }, 0);
  }

  resize(cols: number, rows: number): void {
    this._push({ t: this._t(), kind: 'resize', cols, rows }, 0);
  }

  exit(code: number): void {
    this._push({ t: this._t(), kind: 'exit', code }, 0);
  }

  serialize(): string {
    return this._entries.map(e => JSON.stringify(e)).join('\n');
  }

  clear(): void {
    this._entries = [];
    this._bytes = 0;
  }

  private _t(): number {
    return this._now() - this._start;
  }

  private _push(entry: PtyRecordingEntry, size: number): void {
    this._entries.push(entry);
    this._bytes += size;
    // Evict whole entries from the front. Never slice a payload: a recording
    // that starts mid-escape-sequence replays into garbage, and unlike a
    // shorter recording that failure is silent.
    while (this._bytes > this._maxBytes && this._entries.length > 1) {
      const dropped = this._entries.shift()!;
      if (dropped.kind === 'data') {
        this._bytes -= Buffer.from(dropped.d, 'base64').length;
      }
    }
  }
}

const KINDS = new Set(['data', 'termios', 'resize', 'exit']);

export function parseRecording(jsonl: string): PtyRecording {
  const entries: PtyRecordingEntry[] = [];
  for (const line of jsonl.split('\n')) {
    if (!line.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error(`malformed recording line: ${line}`);
    }
    const e = parsed as { kind?: string };
    if (!e || typeof e.kind !== 'string' || !KINDS.has(e.kind)) {
      throw new Error(`malformed recording line: ${line}`);
    }
    entries.push(parsed as PtyRecordingEntry);
  }
  return { entries };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config tests/vitest.config.ts tests/unit/ptyRecording.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Typecheck and run the full suite**

Run: `npx tsc --noEmit && npm test`
Expected: tsc clean; full suite green with the new file's tests added.

- [ ] **Step 6: Commit**

```bash
git add src/utils/ptyRecording.ts tests/unit/ptyRecording.test.ts
git commit -m "feat(recording): PTY recording format and ring buffer

Chunk boundaries and out-of-band termios events are both preserved:
BlockSegmenter's _altScreenTail exists because escapes split across
chunks, and mode resolution depends on when termios arrives relative
to bytes. Neither is reproducible from a flattened byte stream.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: Wire the recorder into the live PTY path with a save action

The recorder is useless until it is always on — the whole ergonomic point is that capture happens *after* you notice the anomaly. It records in the **renderer**, not the main process, because that is where both streams converge in the order the resolver actually observes them: `pty:data` (post-coalescing, so it matches the chunking `BlockSegmenter` really sees) and `pty:echo-change` (out-of-band IPC).

Saving needs a main-process file write, so this task adds one small IPC.

**Files:**
- Create: `electron/services/recordingSave.ts`
- Modify: `electron/preload.ts` (add `debug.saveRecording`)
- Modify: `electron/main.ts` (register the handler)
- Modify: `src/types/window.d.ts` (declare `debug.saveRecording`)
- Modify: `src/components/TerminalSession.tsx` (own a `PtyRecorder`, feed it, expose the save)
- Test: `tests/unit/recordingSave.test.ts`

**Interfaces:**
- Consumes: `PtyRecorder`, `RECORDING_RING_BYTES` from Task 1.
- Produces:
  ```ts
  // electron/services/recordingSave.ts
  export function registerRecordingSave(
    ipcMain: Electron.IpcMain,
    deps: {
      showSaveDialog: (opts: { defaultPath: string }) => Promise<{ canceled: boolean; filePath?: string }>;
      writeFile: (path: string, data: string) => Promise<void>;
      defaultDir: () => string;
    },
  ): void;
  // registers 'debug:save-recording', (jsonl: string) => Promise<string | null>
  // returns the written path, or null when the user cancelled

  // renderer
  window.tai.debug.saveRecording(jsonl: string): Promise<string | null>
  ```

**Notes for the implementer:**
- The dependency-injected shape (`showSaveDialog`, `writeFile`, `defaultDir`) exists so the handler is testable without Electron. `tests/__mocks__/electron.ts` already stubs the `electron` module; follow the pattern used by other `electron/services/*` tests.
- The default filename is `tai-pty-<n>.jsonl` where `<n>` is the pty id. Do **not** put a timestamp in it via `Date.now()` inside a pure helper you also test — take it as an argument from the caller.
- **Privacy (from the spec, non-negotiable):** the ring buffer is memory-only. Nothing is written to disk until the user picks a path in the save dialog. Do not add an auto-save, a crash dump, a temp file, or telemetry. `redactSecrets.ts` is deliberately **not** applied at capture time — redacting raw bytes would corrupt escape sequences and destroy the fidelity that makes the recording worth having.
- The save dialog message must carry a plain warning. Put it in the dialog's `defaultPath` directory choice? No — put it in the renderer confirmation before calling save (see Step 5), because `showSaveDialog` has no body text on all platforms.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/recordingSave.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { registerRecordingSave } from '../../electron/services/recordingSave';

function fakeIpcMain() {
  const handlers = new Map<string, (...args: any[]) => any>();
  return {
    handle: (channel: string, fn: (...args: any[]) => any) => { handlers.set(channel, fn); },
    invoke: (channel: string, ...args: any[]) => handlers.get(channel)!({}, ...args),
    has: (channel: string) => handlers.has(channel),
  };
}

describe('registerRecordingSave', () => {
  it('registers the debug:save-recording channel', () => {
    const ipc = fakeIpcMain();
    registerRecordingSave(ipc as any, {
      showSaveDialog: async () => ({ canceled: true }),
      writeFile: async () => {},
      defaultDir: () => '/tmp',
    });
    expect(ipc.has('debug:save-recording')).toBe(true);
  });

  it('writes the recording to the chosen path and returns it', async () => {
    const ipc = fakeIpcMain();
    const writeFile = vi.fn(async () => {});
    registerRecordingSave(ipc as any, {
      showSaveDialog: async () => ({ canceled: false, filePath: '/home/u/rec.jsonl' }),
      writeFile,
      defaultDir: () => '/tmp',
    });

    const result = await ipc.invoke('debug:save-recording', '{"t":0,"kind":"data","d":"aGk="}', 'tai-pty-3.jsonl');

    expect(writeFile).toHaveBeenCalledWith('/home/u/rec.jsonl', '{"t":0,"kind":"data","d":"aGk="}');
    expect(result).toBe('/home/u/rec.jsonl');
  });

  it('writes nothing and returns null when the user cancels', async () => {
    const ipc = fakeIpcMain();
    const writeFile = vi.fn(async () => {});
    registerRecordingSave(ipc as any, {
      showSaveDialog: async () => ({ canceled: true }),
      writeFile,
      defaultDir: () => '/tmp',
    });

    const result = await ipc.invoke('debug:save-recording', 'x', 'tai-pty-1.jsonl');

    expect(writeFile).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it('rejects a non-string payload rather than writing it', async () => {
    const ipc = fakeIpcMain();
    const writeFile = vi.fn(async () => {});
    registerRecordingSave(ipc as any, {
      showSaveDialog: async () => ({ canceled: false, filePath: '/x' }),
      writeFile,
      defaultDir: () => '/tmp',
    });

    const result = await ipc.invoke('debug:save-recording', { evil: true }, 'n.jsonl');

    expect(writeFile).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it('defaults the save path into the provided directory', async () => {
    const ipc = fakeIpcMain();
    const showSaveDialog = vi.fn(async () => ({ canceled: true }));
    registerRecordingSave(ipc as any, {
      showSaveDialog,
      writeFile: async () => {},
      defaultDir: () => '/home/u/Documents',
    });

    await ipc.invoke('debug:save-recording', 'x', 'tai-pty-7.jsonl');

    expect(showSaveDialog).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: '/home/u/Documents/tai-pty-7.jsonl' }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config tests/vitest.config.ts tests/unit/recordingSave.test.ts`
Expected: FAIL — cannot resolve `../../electron/services/recordingSave`.

- [ ] **Step 3: Write the main-process handler**

Create `electron/services/recordingSave.ts`:

```ts
import path from 'node:path';

/**
 * Saving a PTY recording is an explicit, user-initiated action. The ring buffer
 * that feeds it lives in renderer memory and never touches disk on its own —
 * no auto-save, no crash dump, no temp file.
 *
 * The recording is deliberately NOT passed through redactSecrets: it holds raw
 * bytes, and rewriting them would corrupt the escape sequences that make the
 * recording reproducible in the first place. Redaction belongs on the
 * export/share path, not on capture.
 */
export interface RecordingSaveDeps {
  showSaveDialog: (opts: { defaultPath: string }) => Promise<{ canceled: boolean; filePath?: string }>;
  writeFile: (filePath: string, data: string) => Promise<void>;
  defaultDir: () => string;
}

export function registerRecordingSave(
  ipcMain: Electron.IpcMain,
  deps: RecordingSaveDeps,
): void {
  ipcMain.handle('debug:save-recording', async (_event, jsonl: unknown, filename: unknown) => {
    if (typeof jsonl !== 'string') return null;
    const name = typeof filename === 'string' && filename ? filename : 'tai-pty.jsonl';
    const res = await deps.showSaveDialog({
      defaultPath: path.join(deps.defaultDir(), name),
    });
    if (res.canceled || !res.filePath) return null;
    await deps.writeFile(res.filePath, jsonl);
    return res.filePath;
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config tests/vitest.config.ts tests/unit/recordingSave.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Register the handler in main and expose it through preload**

In `electron/main.ts`, alongside the other service registrations (find where `registerPty` / the other `electron/services` modules are wired and follow that placement), add:

```ts
import { app, dialog } from 'electron';
import { writeFile } from 'node:fs/promises';
import { registerRecordingSave } from './services/recordingSave';

registerRecordingSave(ipcMain, {
  showSaveDialog: (opts) => dialog.showSaveDialog(opts),
  writeFile: (p, data) => writeFile(p, data, 'utf8'),
  defaultDir: () => app.getPath('documents'),
});
```

(Reuse the existing `ipcMain` import already present in the file rather than adding a second one.)

In `electron/preload.ts`, add a `debug` namespace next to the existing `pty` namespace:

```ts
  debug: {
    saveRecording: (jsonl: string, filename: string) =>
      ipcRenderer.invoke('debug:save-recording', jsonl, filename),
  },
```

In `src/types/window.d.ts`, add the matching declaration to the `tai` interface:

```ts
    debug?: {
      saveRecording?: (jsonl: string, filename: string) => Promise<string | null>;
    };
```

- [ ] **Step 6: Feed the recorder from TerminalSession**

In `src/components/TerminalSession.tsx`:

Add the import alongside the other `@/utils` imports:

```ts
import { PtyRecorder } from '@/utils/ptyRecording';
```

Add a ref next to the other session refs (near `segmenterRef`):

```ts
  // Always-on, memory-only PTY recording. Capture is worthless if you have to
  // turn it on before the bug happens, so it runs unconditionally and the user
  // saves it after the fact. Nothing reaches disk without an explicit save.
  const recorderRef = useRef<PtyRecorder>(new PtyRecorder());
```

In the `onData` handler (currently around `TerminalSession.tsx:715`), record **before** dispatching, so the recording reflects arrival order exactly:

```ts
    const cleanupData = window.tai?.pty?.onData((id: number, data: string) => {
      if (cancelled) return;
      if (id !== ptyId) return;
      recorderRef.current.data(data);
      if (hiddenXtermRef.current) {
        hiddenXtermRef.current.write(data);
      } else {
        segmenterRef.current.feed(data);
      }
    });
```

In the `onEchoChange` handler (currently around `TerminalSession.tsx:676`), record the termios transition as the first statement after the id guard:

```ts
      if (evtId !== ptyId) return;
      recorderRef.current.termios(e.icanon, e.echo);
```

In the `onResized` handler, record the resize as the first statement after the id guard:

```ts
      if (id !== ptyId) return;
      recorderRef.current.resize(cols, rows);
```

In the effect's cleanup function, alongside `segmenter.reset()`, clear the ring so a torn-down pty does not leak its bytes into the next session:

```ts
      recorderRef.current.clear();
```

- [ ] **Step 7: Add the save action**

Add a callback near the other `useCallback` handlers in `TerminalSession.tsx`:

```ts
  const handleSaveRecording = useCallback(async () => {
    const jsonl = recorderRef.current.serialize();
    if (!jsonl) return;
    const ok = window.confirm(
      'Save PTY recording?\n\n' +
      'This file contains the raw terminal output of this session verbatim, ' +
      'including anything secret that appeared on screen. It is written only ' +
      'to the location you choose and is never uploaded.',
    );
    if (!ok) return;
    await window.tai?.debug?.saveRecording?.(jsonl, `tai-pty-${ptyId ?? 0}.jsonl`);
  }, [ptyId]);
```

Wire it to the existing tab/session context menu if one is present at this level; if there is no natural menu host in this component, expose it on `window` behind an explicit debug name so it is reachable without shipping UI chrome:

```ts
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__taiSaveRecording = handleSaveRecording;
    return () => { delete (window as unknown as Record<string, unknown>).__taiSaveRecording; };
  }, [handleSaveRecording]);
```

Prefer the menu if one exists. The `window` hook is the fallback so this task does not block on UI design.

- [ ] **Step 8: Typecheck and run the full suite**

Run: `npx tsc --noEmit && npm test`
Expected: tsc clean; full suite green. No existing test should change — this task only adds observation.

- [ ] **Step 9: Commit**

```bash
git add electron/services/recordingSave.ts electron/main.ts electron/preload.ts \
        src/types/window.d.ts src/components/TerminalSession.tsx \
        tests/unit/recordingSave.test.ts
git commit -m "feat(recording): always-on memory ring buffer with explicit save

Records in the renderer, where pty:data (post-coalescing, matching the
chunking the segmenter really sees) and pty:echo-change converge in the
order the resolver observes them. Memory-only until the user saves.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: Replay harness

The harness is what turns a recording into a test. It must drive the segmenter with the **original chunking** and feed termios events at their recorded position in the stream, and it must report the **mode transition timeline** as well as the resulting blocks — a block snapshot alone cannot show flapping, which is the failure mode this whole project is about.

At this task the resolver does not exist yet (Task 6), so the harness records mode transitions from the segmenter's *existing* `onAltScreen` / `onInteractiveMode` callbacks plus raw termios events. Task 6 extends it. This ordering is deliberate: the timeline captured here is the **baseline** that proves Task 7's refactor is behaviour-neutral.

**Files:**
- Create: `tests/helpers/replayPty.ts`
- Create: `tests/fixtures/pty/README.md`
- Test: `tests/unit/replayPty.test.ts`

**Interfaces:**
- Consumes: `PtyRecording`, `parseRecording` from Task 1; `BlockSegmenter` from `@/components/BlockSegmenter`.
- Produces:
  ```ts
  export interface ReplayEvent {
    t: number;
    /** e.g. 'altScreen:true', 'interactive:true:fullscreen', 'termios:raw' */
    label: string;
  }

  export interface ReplayResult {
    blocks: SegmentedBlock[];
    timeline: ReplayEvent[];
    /** timeline labels only — the ergonomic form for snapshot assertions */
    transitions: string[];
  }

  export function replayRecording(rec: PtyRecording): ReplayResult;
  export function replayFixture(name: string): ReplayResult;
  ```

**Notes for the implementer:**
- `replayFixture(name)` reads `tests/fixtures/pty/<name>.jsonl` with `fs.readFileSync` and parses it. Resolve the path relative to the helper file using `new URL('../fixtures/pty/...', import.meta.url)` or `path.join(__dirname, '../fixtures/pty', ...)` — whichever the repo's other helpers use; the test environment is `node` so both work.
- Termios entries have no consumer inside `BlockSegmenter` today. Record them into the timeline anyway (`termios:raw` when `!icanon`, `termios:password` when `!echo && icanon`, `termios:cooked` otherwise) — that is exactly the mapping `termiosPoller.ts:82-83` performs, and Task 6 will route them into the resolver.
- Do not sleep or use timers. Replay is synchronous: entries are applied in array order, and `t` is carried onto the emitted events purely as metadata.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/replayPty.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { PtyRecorder, parseRecording } from '@/utils/ptyRecording';
import { replayRecording } from '../helpers/replayPty';

function osc133(letter: string) {
  return `\x1b]133;${letter}\x07`;
}

describe('replayRecording', () => {
  it('reproduces blocks from a recorded integrated session', () => {
    const rec = new PtyRecorder(() => 0);
    rec.data(osc133('A'));
    rec.data('mike@host:~$ ');
    rec.data(osc133('B'));
    rec.data('echo hi\n');
    rec.data(osc133('C'));
    rec.data('hi\n');
    rec.data(osc133('D;0'));
    rec.data(osc133('A'));
    rec.data('mike@host:~$ ');
    rec.data(osc133('B'));

    const result = replayRecording(parseRecording(rec.serialize()));

    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].command).toBe('echo hi');
    expect(result.blocks[0].output).toBe('hi');
    expect(result.blocks[0].exitCode).toBe(0);
  });

  it('preserves the original chunk boundaries', () => {
    // The alt-screen enter sequence is split across two chunks. This only
    // resolves correctly if the replay feeds the chunks exactly as recorded —
    // the segmenter's _altScreenTail lookback is what stitches it.
    const rec = new PtyRecorder(() => 0);
    rec.data(osc133('A'));
    rec.data('$ ');
    rec.data(osc133('B'));
    rec.data('htop\n');
    rec.data(osc133('C'));
    rec.data('\x1b[?');
    rec.data('1049h');

    const result = replayRecording(parseRecording(rec.serialize()));

    expect(result.transitions).toContain('altScreen:true');
  });

  it('records termios transitions into the timeline with their timestamps', () => {
    const rec = new PtyRecorder(() => 0);
    rec.termios(false, true);   // raw mode
    rec.termios(true, false);   // password prompt shape
    rec.termios(true, true);    // back to cooked

    const result = replayRecording(parseRecording(rec.serialize()));

    expect(result.transitions).toEqual([
      'termios:raw',
      'termios:password',
      'termios:cooked',
    ]);
    expect(result.timeline.every(e => typeof e.t === 'number')).toBe(true);
  });

  it('interleaves termios events with data in recorded order', () => {
    const rec = new PtyRecorder(() => 0);
    rec.data(osc133('A'));
    rec.data('$ ');
    rec.data(osc133('B'));
    rec.data('claude\n');
    rec.data(osc133('C'));
    rec.data('\x1b[2A');        // TUI reposition — inferred flip, fires first
    rec.termios(false, true);   // termios confirms, 700ms later in real life

    const result = replayRecording(parseRecording(rec.serialize()));

    expect(result.transitions).toEqual(['altScreen:true', 'termios:raw']);
  });

  it('returns an empty result for an empty recording', () => {
    const result = replayRecording({ entries: [] });
    expect(result.blocks).toEqual([]);
    expect(result.transitions).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config tests/vitest.config.ts tests/unit/replayPty.test.ts`
Expected: FAIL — cannot resolve `../helpers/replayPty`.

- [ ] **Step 3: Write the harness**

Create `tests/helpers/replayPty.ts`:

```ts
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BlockSegmenter } from '@/components/BlockSegmenter';
import { parseRecording, type PtyRecording } from '@/utils/ptyRecording';
import type { SegmentedBlock } from '@/types';

export interface ReplayEvent {
  t: number;
  label: string;
}

export interface ReplayResult {
  blocks: SegmentedBlock[];
  timeline: ReplayEvent[];
  /** Labels only. The ergonomic form for assertions; flapping shows up here. */
  transitions: string[];
}

/**
 * Drive a fresh BlockSegmenter from a recording, preserving the original chunk
 * boundaries and the interleaving of out-of-band events.
 *
 * The timeline is the point of this helper. A block snapshot tells you the
 * final answer; only the transition sequence tells you the terminal flapped
 * three times on the way there, which is the failure class this corpus exists
 * to catch.
 */
export function replayRecording(rec: PtyRecording): ReplayResult {
  const seg = new BlockSegmenter();
  const blocks: SegmentedBlock[] = [];
  const timeline: ReplayEvent[] = [];
  let now = 0;

  seg.onBlock(b => blocks.push(b));
  seg.onAltScreen(entered => timeline.push({ t: now, label: `altScreen:${entered}` }));
  seg.onInteractiveMode((entered, fullscreen) => timeline.push({
    t: now,
    label: `interactive:${entered}${entered && fullscreen ? ':fullscreen' : ''}`,
  }));

  for (const entry of rec.entries) {
    now = entry.t;
    switch (entry.kind) {
      case 'data':
        seg.feed(Buffer.from(entry.d, 'base64').toString('utf8'));
        break;
      case 'termios':
        // Same mapping termiosPoller performs: !ICANON is a raw-mode program,
        // !ECHO with ICANON is the classic password-prompt shape.
        timeline.push({
          t: now,
          label: !entry.icanon ? 'termios:raw'
            : !entry.echo ? 'termios:password'
            : 'termios:cooked',
        });
        break;
      case 'resize':
        seg.onResize(entry.cols, entry.rows);
        break;
      case 'exit':
        timeline.push({ t: now, label: `exit:${entry.code}` });
        break;
    }
  }

  return { blocks, timeline, transitions: timeline.map(e => e.label) };
}

export function replayFixture(name: string): ReplayResult {
  // fileURLToPath rather than __dirname: vitest loads these as ESM, where
  // __dirname is not defined.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const file = path.join(here, '..', 'fixtures', 'pty', `${name}.jsonl`);
  return replayRecording(parseRecording(fs.readFileSync(file, 'utf8')));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config tests/vitest.config.ts tests/unit/replayPty.test.ts`
Expected: PASS, 5 tests.

If the "preserves the original chunk boundaries" test fails, do **not** relax the assertion — it is testing the `_altScreenTail` lookback in `BlockSegmenter._feedIntegrated`. Check that the harness is feeding chunks individually rather than joining them.

- [ ] **Step 5: Document the fixture directory**

Create `tests/fixtures/pty/README.md`:

```markdown
# PTY fixtures

Recorded PTY sessions in the JSONL format defined by `src/utils/ptyRecording.ts`,
replayed by `tests/helpers/replayPty.ts`.

## Capturing a fixture

1. Run the app, reproduce the scenario in a terminal tab.
2. Trigger the save action (session context menu, or `__taiSaveRecording()` from
   devtools).
3. Scrub the file before committing: replace real hostnames, usernames, and
   absolute home paths. The bytes are raw terminal output — read the file.
4. Drop it in this directory as `<scenario>.jsonl` and add a replay test.

## Rules

- **Never re-chunk or pretty-print a fixture.** The chunk boundaries are the
  data. `_altScreenTail` in BlockSegmenter exists solely because escape
  sequences split across chunks; joining them makes the fixture test nothing.
- **Never hand-edit the base64 payloads.** Re-record instead.
- Recordings are raw and unredacted by design — redacting bytes would corrupt
  escape sequences. That is why step 3 above is a manual read-through, not an
  automated filter.
```

- [ ] **Step 6: Typecheck and run the full suite**

Run: `npx tsc --noEmit && npm test`
Expected: tsc clean, suite green.

- [ ] **Step 7: Commit**

```bash
git add tests/helpers/replayPty.ts tests/unit/replayPty.test.ts tests/fixtures/pty/README.md
git commit -m "test(recording): replay harness reporting blocks and mode timeline

The transition timeline is the point: a block snapshot shows the final
answer, only the timeline shows the terminal flapped on the way there.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: Baseline fixture corpus (human-in-the-loop)

**This task requires a human to run the app.** Real recordings are the entire point — a hand-authored fixture only tests what its author already understood, and these bugs are precisely the ones nobody understood in advance.

Several of these snapshots will encode today's **wrong** behaviour. That is intentional and must be labelled, not fixed. Without the known-bad baseline, Tasks 5–10 cannot distinguish a fix from a regression.

**Files:**
- Create: `tests/fixtures/pty/*.jsonl` (eight fixtures)
- Create: `tests/unit/replayCorpus.test.ts`

**Interfaces:**
- Consumes: `replayFixture` from Task 3.
- Produces: the fixture corpus, consumed by Tasks 5, 8, 9, 10.

- [ ] **Step 1: Capture the eight seed scenarios**

Build and run the app (`npm run dev`), and in a terminal tab reproduce each scenario, saving a recording after each. Name them exactly:

| Fixture | Scenario | What it pins |
|---|---|---|
| `claude-ink.jsonl` | run `claude`, type a short prompt, exit | Ink TUI that never enters alt screen — the `TUI_REPOSITION_RE` path |
| `vite-shortcuts.jsonl` | run `vite`, press `h` then `q` | raw-mode flip mid-session on a long-runner |
| `python-repl.jsonl` | `python3`, one expression, `exit()` | REPL cursor-back redraws (the `\x1b[<n>D` branch) |
| `htop-altscreen.jsonl` | `htop`, quit with `q` | genuine alt screen — the case where dropping bytes is correct |
| `ssh-interactive.jsonl` | `ssh <host>`, run `ls`, `exit` | interactive SSH; degraded/no remote hooks |
| `ssh-oneshot.jsonl` | `ssh <host> ls` | one-shot SSH that must stay a normal block |
| `prompt-redraw.jsonl` | type a long command with p10k or starship active, edit it, run it | echo reconstruction under prompt redraws |
| `sudo-password.jsonl` | `sudo true`, enter a **throwaway** password | password prompt termios shape |

For `sudo-password.jsonl`, use a disposable password on a scratch account. The recording is unredacted by design; the password is not echoed (that is the point of `!ECHO`), but do not take the risk with a real credential.

- [ ] **Step 2: Scrub each fixture**

For each file, decode and read it before committing:

```bash
node -e '
const fs=require("fs");
for (const l of fs.readFileSync(process.argv[1],"utf8").split("\n").filter(Boolean)) {
  const e=JSON.parse(l);
  if (e.kind==="data") process.stdout.write(Buffer.from(e.d,"base64").toString("utf8"));
}' tests/fixtures/pty/<name>.jsonl
```

Re-record any fixture containing a real hostname, username, absolute home path, or anything sensitive — with those values changed in the environment. Do **not** hand-edit base64 payloads; that desynchronizes chunk boundaries from content and the fixture silently stops testing what it claims to.

- [ ] **Step 3: Write the baseline corpus test**

Create `tests/unit/replayCorpus.test.ts`. Run each fixture, print the actual result once, then paste it in as the expectation and label whether it is correct.

```ts
import { describe, it, expect } from 'vitest';
import { replayFixture } from '../helpers/replayPty';

/**
 * BASELINE CORPUS — captured against pre-migration behaviour.
 *
 * Some expectations below are marked KNOWN-BAD: they encode behaviour that is
 * wrong today and that later tasks in this plan deliberately change. They are
 * committed anyway. Without a pinned baseline there is no way to tell a fix
 * from a regression on exactly the bugs that resist manual reproduction.
 *
 * When a task changes one of these, update the expectation IN THAT TASK'S
 * COMMIT and drop the KNOWN-BAD marker with a note saying which task fixed it.
 */
describe('PTY replay corpus (baseline)', () => {
  it('claude-ink: Ink TUI never enters alt screen', () => {
    const { blocks, transitions } = replayFixture('claude-ink');
    // Fill in from the actual run.
    expect(transitions).toMatchInlineSnapshot();
    expect(blocks.map(b => b.command)).toMatchInlineSnapshot();
  });

  it('vite-shortcuts: raw-mode flip mid-session', () => {
    const { blocks, transitions } = replayFixture('vite-shortcuts');
    expect(transitions).toMatchInlineSnapshot();
    expect(blocks.map(b => b.command)).toMatchInlineSnapshot();
  });

  it('python-repl: cursor-back prompt redraws', () => {
    const { blocks, transitions } = replayFixture('python-repl');
    expect(transitions).toMatchInlineSnapshot();
    expect(blocks.map(b => b.command)).toMatchInlineSnapshot();
  });

  it('htop-altscreen: genuine alt screen', () => {
    const { blocks, transitions } = replayFixture('htop-altscreen');
    expect(transitions).toMatchInlineSnapshot();
    expect(blocks.map(b => b.command)).toMatchInlineSnapshot();
  });

  it('ssh-interactive: interactive session', () => {
    const { blocks, transitions } = replayFixture('ssh-interactive');
    expect(transitions).toMatchInlineSnapshot();
    expect(blocks.map(b => ({ command: b.command, isRemote: b.isRemote }))).toMatchInlineSnapshot();
  });

  it('ssh-oneshot: stays a normal block', () => {
    const { blocks, transitions } = replayFixture('ssh-oneshot');
    expect(transitions).toMatchInlineSnapshot();
    expect(blocks.map(b => ({ command: b.command, isRemote: b.isRemote }))).toMatchInlineSnapshot();
  });

  it('prompt-redraw: command reconstruction under redraws', () => {
    const { blocks } = replayFixture('prompt-redraw');
    // KNOWN-BAD if `command` differs from `commandFromShell` — that is exactly
    // the C-class defect Task 5 fixes.
    expect(blocks.map(b => ({ command: b.command, fromShell: b.commandFromShell }))).toMatchInlineSnapshot();
  });

  it('sudo-password: password prompt shape', () => {
    const { transitions } = replayFixture('sudo-password');
    expect(transitions).toMatchInlineSnapshot();
  });
});
```

Run `npx vitest run --config tests/vitest.config.ts tests/unit/replayCorpus.test.ts -u` to fill the inline snapshots, then **read every filled-in snapshot** and annotate the wrong ones:

```ts
    // KNOWN-BAD (Task 5 fixes): `command` is reconstructed from echoed bytes and
    // picks up the autosuggestion ghost; `fromShell` has it verbatim.
```

- [ ] **Step 4: Verify the corpus is deterministic**

Run the corpus test three times: `for i in 1 2 3; do npx vitest run --config tests/vitest.config.ts tests/unit/replayCorpus.test.ts || break; done`
Expected: PASS all three times.

If a fixture is non-deterministic, it is recording wall-clock-dependent state (a `duration`, a timestamp). Assert on the specific fields listed above rather than whole blocks — never add a retry or a tolerance.

- [ ] **Step 5: Typecheck and run the full suite**

Run: `npx tsc --noEmit && npm test`
Expected: tsc clean, suite green.

- [ ] **Step 6: Commit**

```bash
git add tests/fixtures/pty tests/unit/replayCorpus.test.ts
git commit -m "test(recording): baseline PTY corpus, including known-bad snapshots

Eight recorded scenarios pinned against current behaviour. Several
snapshots encode bugs; they are labelled KNOWN-BAD and committed so the
following tasks can be shown to fix rather than merely move them.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: Take the block command from shell hooks

Rollout step 2 — the smallest diff and the largest immediate win.

Today `_finalizeIntegratedBlock` (`BlockSegmenter.ts:718-733`) derives `command` from `_osc133RawCommand`, the **echoed bytes** between the OSC 133 B and C markers, passed through `renderTermText` to undo the shell's redraws. But the shell already told us the command verbatim: `parseOsc6973` populates `_pendingPreexec` at `BlockSegmenter.ts:483` — a field that is currently **written and never read** — and `_pendingPrecmd.command` is already attached to the block as the secondary field `commandFromShell`, which no consumer reads.

This removes rather than patches an entire symptom class: doubled echo, PS2 artifacts, p10k/starship redraw garbage, autosuggestion ghosts.

It also fixes SSH target parsing for free. `_finalizeIntegratedBlock` ends with `parseInteractiveSshCommand(command)` — parsing the *reconstructed* text. An `ssh` invocation that reconstructs imperfectly yields a wrong host or no session. `sshDetect.ts` is correct and is not touched; it was being fed a corrupted input.

**Files:**
- Modify: `src/components/BlockSegmenter.ts` (`_finalizeIntegratedBlock`, ~lines 700-800)
- Test: `tests/unit/blockSegmenterHooks.test.ts` (extend)
- Modify (if snapshots shift): `tests/unit/replayCorpus.test.ts`

**Interfaces:**
- Consumes: `_pendingPreexec` / `_pendingPrecmd` (already populated), `replayFixture` from Task 3.
- Produces: `SegmentedBlock.command` sourced from hooks when available; `commandFromShell` equal to `command` in that case.

**Precedence rule (implement exactly):**
1. `_pendingPreexec.command` if non-empty — captured at command start, before any output could corrupt it.
2. else `_pendingPrecmd.command` if non-empty — the same text, corroborated at command end.
3. else the existing `renderTermText(_osc133RawCommand)` reconstruction — the non-integrated fallback, unchanged.

Preexec wins over precmd because it is captured earlier and cannot have been affected by the command's own output. In practice they agree.

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/blockSegmenterHooks.test.ts`:

```ts
describe('BlockSegmenter command from hooks', () => {
  it('prefers the preexec command over reconstructed echo', () => {
    const seg = new BlockSegmenter();
    const blocks: any[] = [];
    seg.onBlock(b => blocks.push(b));

    seg.feed(osc133('A'));
    seg.feed('mike@host:~$ ');
    seg.feed(osc133('B'));
    seg.feed(encodeOsc6973({ hook: 'preexec', command: 'git status' }));
    // The echoed bytes are mangled by an autosuggestion ghost the shell then
    // erased — exactly the shape renderTermText has to guess its way through.
    seg.feed('git status --short\x1b[8D\x1b[K');
    seg.feed(osc133('C'));
    seg.feed('On branch master\n');
    seg.feed(osc133('D;0'));
    seg.feed(osc133('A'));
    seg.feed('mike@host:~$ ');
    seg.feed(osc133('B'));

    expect(blocks).toHaveLength(1);
    expect(blocks[0].command).toBe('git status');
    expect(blocks[0].commandFromShell).toBe('git status');
  });

  it('falls back to the precmd command when preexec is absent', () => {
    const seg = new BlockSegmenter();
    const blocks: any[] = [];
    seg.onBlock(b => blocks.push(b));

    seg.feed(osc133('A'));
    seg.feed('$ ');
    seg.feed(osc133('B'));
    seg.feed('garbled\x1b[7D');
    seg.feed(osc133('C'));
    seg.feed('out\n');
    seg.feed(osc133('D;0'));
    seg.feed(encodeOsc6973({
      hook: 'precmd', exit: 0, signal: null, duration_ms: 5,
      command: 'ls -la', cwd: '/tmp',
    }));
    seg.feed(osc133('A'));
    seg.feed('$ ');
    seg.feed(osc133('B'));

    expect(blocks[0].command).toBe('ls -la');
  });

  it('falls back to echo reconstruction when no hooks arrive', () => {
    const seg = new BlockSegmenter();
    const blocks: any[] = [];
    seg.onBlock(b => blocks.push(b));

    seg.feed(osc133('A'));
    seg.feed('$ ');
    seg.feed(osc133('B'));
    seg.feed('echo hi');
    seg.feed(osc133('C'));
    seg.feed('hi\n');
    seg.feed(osc133('D;0'));
    seg.feed(osc133('A'));
    seg.feed('$ ');
    seg.feed(osc133('B'));

    expect(blocks[0].command).toBe('echo hi');
    expect(blocks[0].hooksAvailable).toBe(false);
  });

  it('parses the SSH target from the hook command, not the mangled echo', () => {
    const seg = new BlockSegmenter();
    const sshEvents: Array<[boolean, string | null]> = [];
    seg.onSshSession((active, target) => sshEvents.push([active, target]));

    seg.feed(osc133('A'));
    seg.feed('$ ');
    seg.feed(osc133('B'));
    seg.feed(encodeOsc6973({ hook: 'preexec', command: 'ssh build-01' }));
    // Echo wrapped across a line boundary the way a narrow terminal does it.
    seg.feed('ssh bui\r\nld-01');
    seg.feed(osc133('C'));

    expect(sshEvents).toContainEqual([true, 'build-01']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config tests/vitest.config.ts tests/unit/blockSegmenterHooks.test.ts -t "command from hooks"`
Expected: FAIL — `command` is the reconstructed text (`'git status --short'` or similar), and the SSH target is `'bui'` or missing.

- [ ] **Step 3: Implement the hook-first command source**

In `src/components/BlockSegmenter.ts`, add a private helper next to `_finalizeIntegratedBlock`:

```ts
  /**
   * The command the user actually ran.
   *
   * The shell tells us verbatim via OSC 6973 preexec; reconstructing it from
   * echoed bytes is guesswork that has to undo autosuggestion ghosts, PS2
   * prefixes, prompt redraws and line wrapping. Prefer the hook and keep the
   * reconstruction only for shells with no integration.
   *
   * preexec beats precmd because it is captured before the command produced
   * any output that could interfere; in practice the two agree.
   */
  private _commandText(rawCommand: string): string {
    const hooked = this._pendingPreexec?.command || this._pendingPrecmd?.command;
    if (hooked) return hooked;
    return renderTermText(rawCommand)
      .trim()
      .split('\n')
      .map((l, i) => (i === 0 ? l : stripPs2(l)))
      .join('\n');
  }
```

Replace the existing reconstruction in `_finalizeIntegratedBlock`:

```ts
    // was:
    // const command = renderTermText(rawCommand)
    //   .trim()
    //   .split('\n')
    //   .map((l, i) => (i === 0 ? l : stripPs2(l)))
    //   .join('\n');
    const command = this._commandText(rawCommand);
```

Update the block literal so `commandFromShell` agrees with `command` whenever hooks are present (it stays on the block for compatibility):

```ts
      ...(this._pendingPrecmd ? {
        signal: this._pendingPrecmd.signal,
        cwd: this._pendingPrecmd.cwd,
        commandFromShell: this._pendingPrecmd.command,
      } : {}),
      ...(!this._pendingPrecmd && this._pendingPreexec ? {
        commandFromShell: this._pendingPreexec.command,
      } : {}),
```

Fix the SSH parse at the `C` marker (`BlockSegmenter.ts:589`), which parses the reconstructed text mid-flight:

```ts
        // was: parseInteractiveSshCommand(renderTermText(this._osc133RawCommand).trim())
        const ssh = parseInteractiveSshCommand(this._commandText(this._osc133RawCommand).trim());
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run --config tests/vitest.config.ts tests/unit/blockSegmenterHooks.test.ts`
Expected: PASS, including the four new tests.

- [ ] **Step 5: Run the corpus and update the fixed snapshots**

Run: `npx vitest run --config tests/vitest.config.ts tests/unit/replayCorpus.test.ts`

The `prompt-redraw` expectation should now fail — that is the KNOWN-BAD snapshot this task fixes. Update it with `-u`, then **read the diff** and confirm `command` now equals `commandFromShell`. Replace the `KNOWN-BAD` comment with:

```ts
    // Fixed by Task 5: command now comes from the preexec hook verbatim.
```

If a snapshot changed that you did **not** expect to change, stop and investigate before updating it. An unexplained corpus movement here is the exact signal the baseline exists to produce.

- [ ] **Step 6: Typecheck and run the full suite**

Run: `npx tsc --noEmit && npm test`
Expected: tsc clean, suite green.

- [ ] **Step 7: Commit**

```bash
git add src/components/BlockSegmenter.ts tests/unit/blockSegmenterHooks.test.ts tests/unit/replayCorpus.test.ts
git commit -m "fix(segmenter): take the block command from shell hooks

_pendingPreexec was populated and never read while the block command
was reconstructed from echoed bytes. Removes a symptom class (doubled
echo, PS2 artifacts, prompt-redraw garbage, autosuggestion ghosts) and
fixes SSH target parsing, which was parsing the reconstructed text.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 6: The mode resolver (pure, behaviour-preserving)

Rollout step 3, **first commit**. This task must reproduce today's decisions **exactly**. No rule changes — those are Task 8. Collapsing the two would make Task 8's regressions unattributable, which is the entire reason for the split.

**Files:**
- Create: `src/utils/terminalMode.ts`
- Test: `tests/unit/terminalMode.test.ts`

**Interfaces:**
- Consumes: `ShellHook` from `@/types/shellHooks`.
- Produces:
  ```ts
  export type ModeSignal =
    | { kind: 'termios';    icanon: boolean; echo: boolean }
    | { kind: 'altScreen';  entered: boolean }
    | { kind: 'tuiHint' }
    | { kind: 'osc133';     phase: 'prompt' | 'command' | 'output' | 'idle' }
    | { kind: 'hook';       hook: ShellHook }
    | { kind: 'ptyExit' };

  export type InputOwner = 'shell' | 'program' | 'fullscreen';
  export type Provenance = 'authoritative' | 'inferred' | 'degraded';
  export type DegradedReason = 'no-hooks' | 'no-termios';

  export interface ModeState {
    inputOwner: InputOwner;
    provenance: Provenance;
    degradedReason?: DegradedReason;
    passwordPrompt: boolean;
    commandRunning: boolean;
  }

  export interface ModeResolver {
    apply(signal: ModeSignal): ModeState;
    readonly state: ModeState;
    reset(): void;
  }

  export function createModeResolver(): ModeResolver;
  export const INITIAL_MODE_STATE: ModeState;
  ```

**Provenance semantics (from the spec — these are ordered, not orthogonal):**
- `'authoritative'` — the decision came from termios or an alt-screen escape.
- `'inferred'` — the decision came from `tuiHint`, with an authoritative source available but not yet heard from.
- `'degraded'` — no authoritative source is available for this context at all.

`degradedReason` records *which* source is missing, and the two are independent. On Windows (`'no-termios'`) alt-screen escapes still arrive, so an alt-screen decision there is `'authoritative'` while a raw-mode decision is `'degraded'`. **Degradation is per-source, never global.** Task 10 populates the degraded values; this task defines them and leaves `provenance` at `'authoritative' | 'inferred'`.

**Behaviour to reproduce (verified against current code):**

| Signal | Current behaviour | Resolver rule |
|---|---|---|
| `altScreen: true` | `_inAltScreen = true`, clears interactive (`_feedLegacy`) | `inputOwner: 'fullscreen'`, `provenance: 'authoritative'` |
| `altScreen: false` | `_inAltScreen = false` | `inputOwner: 'shell'`, `provenance: 'authoritative'` |
| `tuiHint` | sets `_inAltScreen = true` (`BlockSegmenter.ts:697`) | `inputOwner: 'program'`, `provenance: 'inferred'` — this is the one place the shape changes, see below |
| `termios !icanon` | `interactiveProgram` → `interactiveMode` after 500ms | `inputOwner: 'program'`, `provenance: 'authoritative'` |
| `termios !echo && icanon` | `passwordPrompt` | `passwordPrompt: true` |
| `termios icanon && echo` | clears both | `inputOwner: 'shell'`, `passwordPrompt: false` |
| `osc133 'output'` | command running | `commandRunning: true` |
| `hook precmd` / `osc133 'prompt'` | command over | `inputOwner: 'shell'`, `commandRunning: false` |
| `ptyExit` | teardown | reset to `INITIAL_MODE_STATE` |

The one deliberate shape change: `tuiHint` resolves to `'program'`, not `'fullscreen'`. Today it sets the same `_inAltScreen` flag as a real alt-screen escape, which is precisely the conflation the spec calls out (`_inAltScreen` means both "on the alt screen" and "owns line editing"). Separating the two values is **not** a behaviour change yet — Task 7 maps `'program'` and `'fullscreen'` back onto today's flags such that the observable surface is identical. Task 8 is where the difference starts to matter.

**Resolution rules to implement:**
1. **Tiered authority.** `termios` and `altScreen` are authoritative and always win.
2. **`tuiHint` may only promote.** It moves `shell → program` and nothing else. It never demotes, and it is ignored once an authoritative signal has been received for the current command.
3. **Two facts, two values.** `'fullscreen'` is alt-screen takeover; `'program'` is raw-mode line-editing ownership.
4. **A command boundary resets inference.** `precmd` / OSC 133 `'prompt'` returns `inputOwner` to `'shell'` and clears the "authoritative signal seen" latch for the next command.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/terminalMode.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createModeResolver, INITIAL_MODE_STATE, type ModeSignal } from '@/utils/terminalMode';

/** Apply a sequence and return the inputOwner:provenance timeline. */
function timeline(signals: ModeSignal[]): string[] {
  const r = createModeResolver();
  return signals.map(s => {
    const st = r.apply(s);
    return `${st.inputOwner}:${st.provenance}`;
  });
}

describe('createModeResolver', () => {
  it('starts at the shell with no command running', () => {
    const r = createModeResolver();
    expect(r.state).toEqual(INITIAL_MODE_STATE);
    expect(r.state.inputOwner).toBe('shell');
    expect(r.state.commandRunning).toBe(false);
    expect(r.state.passwordPrompt).toBe(false);
  });
});

describe('rule 1: termios and altScreen are authoritative', () => {
  it('termios raw mode makes the program the input owner', () => {
    const r = createModeResolver();
    const st = r.apply({ kind: 'termios', icanon: false, echo: true });
    expect(st.inputOwner).toBe('program');
    expect(st.provenance).toBe('authoritative');
  });

  it('alt-screen entry makes it fullscreen', () => {
    const r = createModeResolver();
    const st = r.apply({ kind: 'altScreen', entered: true });
    expect(st.inputOwner).toBe('fullscreen');
    expect(st.provenance).toBe('authoritative');
  });

  it('alt-screen exit returns ownership to the shell', () => {
    const r = createModeResolver();
    r.apply({ kind: 'altScreen', entered: true });
    const st = r.apply({ kind: 'altScreen', entered: false });
    expect(st.inputOwner).toBe('shell');
    expect(st.provenance).toBe('authoritative');
  });

  it('termios returning to cooked mode returns ownership to the shell', () => {
    const r = createModeResolver();
    r.apply({ kind: 'termios', icanon: false, echo: true });
    const st = r.apply({ kind: 'termios', icanon: true, echo: true });
    expect(st.inputOwner).toBe('shell');
  });
});

describe('rule 2: tuiHint may only promote', () => {
  it('promotes shell to program, marked inferred', () => {
    expect(timeline([{ kind: 'tuiHint' }])).toEqual(['program:inferred']);
  });

  it('never demotes fullscreen', () => {
    const r = createModeResolver();
    r.apply({ kind: 'altScreen', entered: true });
    const st = r.apply({ kind: 'tuiHint' });
    expect(st.inputOwner).toBe('fullscreen');
    expect(st.provenance).toBe('authoritative');
  });

  it('is ignored once termios has spoken for this command', () => {
    const r = createModeResolver();
    r.apply({ kind: 'osc133', phase: 'output' });
    r.apply({ kind: 'termios', icanon: true, echo: true });   // authoritative: cooked
    const st = r.apply({ kind: 'tuiHint' });
    expect(st.inputOwner).toBe('shell');
    expect(st.provenance).toBe('authoritative');
  });

  it('yields to a later authoritative signal that contradicts it', () => {
    expect(timeline([
      { kind: 'osc133', phase: 'output' },
      { kind: 'tuiHint' },
      { kind: 'termios', icanon: true, echo: true },
    ])).toEqual(['shell:authoritative', 'program:inferred', 'shell:authoritative']);
  });

  it('is confirmed by a later authoritative signal that agrees', () => {
    expect(timeline([
      { kind: 'osc133', phase: 'output' },
      { kind: 'tuiHint' },
      { kind: 'termios', icanon: false, echo: true },
    ])).toEqual(['shell:authoritative', 'program:inferred', 'program:authoritative']);
  });
});

describe('rule 3: program and fullscreen are distinct', () => {
  it('an Ink TUI that never enters alt screen is program, not fullscreen', () => {
    const r = createModeResolver();
    r.apply({ kind: 'osc133', phase: 'output' });
    r.apply({ kind: 'tuiHint' });
    const st = r.apply({ kind: 'termios', icanon: false, echo: true });
    expect(st.inputOwner).toBe('program');
  });

  it('htop entering the alt screen is fullscreen even in raw mode', () => {
    const r = createModeResolver();
    r.apply({ kind: 'termios', icanon: false, echo: true });
    const st = r.apply({ kind: 'altScreen', entered: true });
    expect(st.inputOwner).toBe('fullscreen');
  });
});

describe('rule 4: a command boundary resets inference', () => {
  it('a precmd hook returns ownership to the shell', () => {
    const r = createModeResolver();
    r.apply({ kind: 'tuiHint' });
    const st = r.apply({
      kind: 'hook',
      hook: { hook: 'precmd', exit: 0, signal: null, duration_ms: 1, command: 'x', cwd: '/' },
    });
    expect(st.inputOwner).toBe('shell');
    expect(st.commandRunning).toBe(false);
  });

  it('an OSC 133 prompt phase returns ownership to the shell', () => {
    const r = createModeResolver();
    r.apply({ kind: 'tuiHint' });
    const st = r.apply({ kind: 'osc133', phase: 'prompt' });
    expect(st.inputOwner).toBe('shell');
  });

  it('re-arms tuiHint for the next command after an authoritative signal', () => {
    expect(timeline([
      { kind: 'osc133', phase: 'output' },
      { kind: 'termios', icanon: true, echo: true },
      { kind: 'tuiHint' },                              // ignored: termios spoke
      { kind: 'osc133', phase: 'prompt' },              // boundary re-arms
      { kind: 'osc133', phase: 'output' },
      { kind: 'tuiHint' },                              // honoured again
    ])).toEqual([
      'shell:authoritative',
      'shell:authoritative',
      'shell:authoritative',
      'shell:authoritative',
      'shell:authoritative',
      'program:inferred',
    ]);
  });
});

describe('command running and password prompt', () => {
  it('tracks commandRunning across the OSC 133 phases', () => {
    const r = createModeResolver();
    expect(r.apply({ kind: 'osc133', phase: 'output' }).commandRunning).toBe(true);
    expect(r.apply({ kind: 'osc133', phase: 'prompt' }).commandRunning).toBe(false);
  });

  it('a preexec hook marks the command as running', () => {
    const r = createModeResolver();
    const st = r.apply({ kind: 'hook', hook: { hook: 'preexec', command: 'ls' } });
    expect(st.commandRunning).toBe(true);
  });

  it('flags the password-prompt termios shape without changing ownership', () => {
    const r = createModeResolver();
    const st = r.apply({ kind: 'termios', icanon: true, echo: false });
    expect(st.passwordPrompt).toBe(true);
    expect(st.inputOwner).toBe('shell');
  });

  it('clears the password flag when echo returns', () => {
    const r = createModeResolver();
    r.apply({ kind: 'termios', icanon: true, echo: false });
    const st = r.apply({ kind: 'termios', icanon: true, echo: true });
    expect(st.passwordPrompt).toBe(false);
  });

  it('does not flag a password prompt in raw mode', () => {
    const r = createModeResolver();
    const st = r.apply({ kind: 'termios', icanon: false, echo: false });
    expect(st.passwordPrompt).toBe(false);
    expect(st.inputOwner).toBe('program');
  });
});

describe('lifecycle', () => {
  it('ptyExit resets to the initial state', () => {
    const r = createModeResolver();
    r.apply({ kind: 'altScreen', entered: true });
    r.apply({ kind: 'osc133', phase: 'output' });
    const st = r.apply({ kind: 'ptyExit' });
    expect(st).toEqual(INITIAL_MODE_STATE);
  });

  it('reset() restores the initial state', () => {
    const r = createModeResolver();
    r.apply({ kind: 'altScreen', entered: true });
    r.reset();
    expect(r.state).toEqual(INITIAL_MODE_STATE);
  });

  it('returns a state object equal to the readable state property', () => {
    const r = createModeResolver();
    const returned = r.apply({ kind: 'tuiHint' });
    expect(returned).toEqual(r.state);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config tests/vitest.config.ts tests/unit/terminalMode.test.ts`
Expected: FAIL — cannot resolve `@/utils/terminalMode`.

- [ ] **Step 3: Write the resolver**

Create `src/utils/terminalMode.ts`:

```ts
import type { ShellHook } from '@/types/shellHooks';

/**
 * Who owns the terminal input right now, and how we know.
 *
 * The bug class this exists to kill: three independent deciders answered "is a
 * raw-mode program running?" with different latencies — a byte regex (instant),
 * an alt-screen escape scan (instant), and termios over IPC (200ms poll plus a
 * 500ms debounce). The results landed in three React flags whose precedence was
 * resolved ad hoc, so on every TUI launch there was a window where they
 * disagreed, and the loser silently discarded PTY output.
 *
 * One reducer, one state, and — critically — the state carries its own
 * provenance so consumers can branch on HOW WE KNOW rather than only on what we
 * know. Dropping bytes is safe under an authoritative signal and reckless under
 * a guess; without provenance there is no way to express that difference.
 */

export type ModeSignal =
  | { kind: 'termios';    icanon: boolean; echo: boolean }   // authoritative
  | { kind: 'altScreen';  entered: boolean }                 // authoritative
  | { kind: 'tuiHint' }                                      // inferred
  | { kind: 'osc133';     phase: 'prompt' | 'command' | 'output' | 'idle' }
  | { kind: 'hook';       hook: ShellHook }
  | { kind: 'ptyExit' };

export type InputOwner = 'shell' | 'program' | 'fullscreen';

/**
 * Ordered, not orthogonal:
 *  - 'authoritative' — from termios or an alt-screen escape.
 *  - 'inferred'      — from a tuiHint, with an authoritative source available
 *                      but not yet heard from.
 *  - 'degraded'      — no authoritative source is available for this context.
 */
export type Provenance = 'authoritative' | 'inferred' | 'degraded';

/** Which authoritative source is missing. Degradation is per-source, never global. */
export type DegradedReason = 'no-hooks' | 'no-termios';

export interface ModeState {
  inputOwner: InputOwner;
  provenance: Provenance;
  degradedReason?: DegradedReason;
  passwordPrompt: boolean;
  commandRunning: boolean;
}

export interface ModeResolver {
  apply(signal: ModeSignal): ModeState;
  readonly state: ModeState;
  reset(): void;
}

export const INITIAL_MODE_STATE: ModeState = {
  inputOwner: 'shell',
  provenance: 'authoritative',
  passwordPrompt: false,
  commandRunning: false,
};

export function createModeResolver(): ModeResolver {
  let state: ModeState = { ...INITIAL_MODE_STATE };
  // Rule 2: a hint is only trusted until an authoritative source speaks for
  // this command. Cleared at every command boundary (rule 4) so the next
  // command's fast path is live again.
  let authoritativeThisCommand = false;

  function set(next: Partial<ModeState>): ModeState {
    state = { ...state, ...next };
    return state;
  }

  function apply(signal: ModeSignal): ModeState {
    switch (signal.kind) {
      case 'termios': {
        authoritativeThisCommand = true;
        // Same mapping the kernel-side poller performs: !ICANON is a raw-mode
        // program, !ECHO with ICANON is the classic password-prompt shape.
        const password = !signal.echo && signal.icanon;
        // Rule 3: an alt-screen takeover is a stronger claim than raw mode and
        // is not revoked by a termios reading — htop is fullscreen AND raw.
        const owner: InputOwner = state.inputOwner === 'fullscreen'
          ? 'fullscreen'
          : (!signal.icanon ? 'program' : 'shell');
        return set({
          inputOwner: owner,
          provenance: 'authoritative',
          passwordPrompt: password,
          degradedReason: undefined,
        });
      }

      case 'altScreen': {
        authoritativeThisCommand = true;
        return set({
          inputOwner: signal.entered ? 'fullscreen' : 'shell',
          provenance: 'authoritative',
          degradedReason: undefined,
        });
      }

      case 'tuiHint': {
        // Rule 2: promote only, and only while no authoritative source has
        // spoken for this command.
        if (authoritativeThisCommand) return state;
        if (state.inputOwner !== 'shell') return state;
        return set({ inputOwner: 'program', provenance: 'inferred' });
      }

      case 'osc133': {
        if (signal.phase === 'output' || signal.phase === 'command') {
          return set({ commandRunning: signal.phase === 'output' });
        }
        // Rule 4: a prompt is proof the foreground is the shell again.
        authoritativeThisCommand = false;
        return set({
          inputOwner: 'shell',
          provenance: 'authoritative',
          commandRunning: false,
          passwordPrompt: false,
        });
      }

      case 'hook': {
        if (signal.hook.hook === 'preexec') {
          return set({ commandRunning: true });
        }
        // precmd — same boundary semantics as an OSC 133 prompt.
        authoritativeThisCommand = false;
        return set({
          inputOwner: 'shell',
          provenance: 'authoritative',
          commandRunning: false,
          passwordPrompt: false,
        });
      }

      case 'ptyExit': {
        authoritativeThisCommand = false;
        state = { ...INITIAL_MODE_STATE };
        return state;
      }
    }
  }

  return {
    apply,
    get state() { return state; },
    reset() {
      state = { ...INITIAL_MODE_STATE };
      authoritativeThisCommand = false;
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config tests/vitest.config.ts tests/unit/terminalMode.test.ts`
Expected: PASS, 22 tests.

- [ ] **Step 5: Typecheck and run the full suite**

Run: `npx tsc --noEmit && npm test`
Expected: tsc clean, suite green. Nothing consumes the resolver yet, so no existing test moves.

- [ ] **Step 6: Commit**

```bash
git add src/utils/terminalMode.ts tests/unit/terminalMode.test.ts
git commit -m "feat(mode): pure terminal-mode resolver with provenance

One reducer replacing three racing deciders. State carries how we know,
not only what we know, so consumers can treat a guess differently from a
kernel fact. Not wired in yet.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 7: Wire the resolver in, behaviour-neutral

Rollout step 3, still the **first commit's** scope: move the decision-making without changing any decision. The 500ms debounce stays for now — removing it is a rule change and belongs to Task 8.

The proof obligation for this task is specific: **the replay timelines must be identical to the baseline.** If a corpus snapshot moves here, the refactor was not neutral.

**Files:**
- Modify: `src/components/BlockSegmenter.ts` (emit `ModeSignal`s alongside existing callbacks)
- Modify: `src/components/TerminalSession.tsx` (own a resolver, derive the three flags from it)
- Modify: `tests/helpers/replayPty.ts` (drive the resolver, add its transitions to the timeline)
- Test: `tests/unit/blockSegmenterModeSignals.test.ts`

**Interfaces:**
- Consumes: `createModeResolver`, `ModeSignal`, `ModeState` from Task 6.
- Produces:
  ```ts
  // BlockSegmenter
  type ModeSignalCallback = (signal: ModeSignal) => void;
  onModeSignal(cb: ModeSignalCallback): void;
  ```

**Notes for the implementer:**
- `BlockSegmenter` **keeps** `onAltScreen` and `onInteractiveMode` in this task. They are deleted in Task 8. Emitting signals *in addition* is what makes this step neutral and reviewable.
- In `TerminalSession`, the three `useState` flags stay. They are now *derived* from `ModeState` by an explicit mapping rather than set from three places:
  - `altScreenVisible` ⟵ `inputOwner === 'fullscreen'`
  - `interactiveMode` ⟵ `inputOwner === 'program' || inputOwner === 'fullscreen'`
  - `interactiveFullscreen` ⟵ `inputOwner === 'fullscreen'`

  This mapping is what preserves today's observable surface while the internal model becomes two-valued: `deriveInputSurface` checks `altScreenVisible || (interactiveMode && interactiveFullscreen)` for `'fullscreen'` and `interactiveMode` for `'docked'`, so the mapping above reproduces both branches exactly.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/blockSegmenterModeSignals.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { BlockSegmenter } from '@/components/BlockSegmenter';
import type { ModeSignal } from '@/utils/terminalMode';

function osc133(letter: string) {
  return `\x1b]133;${letter}\x07`;
}

function collect(): { signals: ModeSignal[]; seg: BlockSegmenter } {
  const seg = new BlockSegmenter();
  const signals: ModeSignal[] = [];
  seg.onModeSignal(s => signals.push(s));
  return { signals, seg };
}

describe('BlockSegmenter mode signals', () => {
  it('emits an altScreen signal on entry and exit', () => {
    const { seg, signals } = collect();
    seg.feed(osc133('A'));
    seg.feed('$ ');
    seg.feed(osc133('B'));
    seg.feed('htop\n');
    seg.feed(osc133('C'));
    seg.feed('\x1b[?1049h');
    seg.feed('\x1b[?1049l');

    expect(signals).toContainEqual({ kind: 'altScreen', entered: true });
    expect(signals).toContainEqual({ kind: 'altScreen', entered: false });
  });

  it('emits a tuiHint for a cursor-reposition redraw, not an altScreen signal', () => {
    const { seg, signals } = collect();
    seg.feed(osc133('A'));
    seg.feed('$ ');
    seg.feed(osc133('B'));
    seg.feed('claude\n');
    seg.feed(osc133('C'));
    seg.feed('\x1b[2A');

    expect(signals).toContainEqual({ kind: 'tuiHint' });
    expect(signals).not.toContainEqual({ kind: 'altScreen', entered: true });
  });

  it('emits osc133 phase signals', () => {
    const { seg, signals } = collect();
    seg.feed(osc133('A'));
    seg.feed('$ ');
    seg.feed(osc133('B'));
    seg.feed('ls\n');
    seg.feed(osc133('C'));

    const phases = signals.filter(s => s.kind === 'osc133').map(s => (s as { phase: string }).phase);
    expect(phases).toEqual(['prompt', 'command', 'output']);
  });

  it('emits hook signals for preexec and precmd', async () => {
    const { encodeOsc6973 } = await import('@/utils/osc6973');
    const { seg, signals } = collect();
    seg.feed(osc133('A'));
    seg.feed('$ ');
    seg.feed(osc133('B'));
    seg.feed(encodeOsc6973({ hook: 'preexec', command: 'ls' }));
    seg.feed(osc133('C'));
    seg.feed(osc133('D;0'));
    seg.feed(encodeOsc6973({
      hook: 'precmd', exit: 0, signal: null, duration_ms: 1, command: 'ls', cwd: '/',
    }));

    const hooks = signals.filter(s => s.kind === 'hook').map(s => (s as any).hook.hook);
    expect(hooks).toEqual(['preexec', 'precmd']);
  });

  it('still fires the legacy altScreen and interactive callbacks', () => {
    // This task is additive; Task 8 removes these. Their survival here is what
    // makes the refactor reviewable as behaviour-neutral.
    const seg = new BlockSegmenter();
    const alt: boolean[] = [];
    seg.onAltScreen(e => alt.push(e));

    seg.feed(osc133('A'));
    seg.feed('$ ');
    seg.feed(osc133('B'));
    seg.feed('htop\n');
    seg.feed(osc133('C'));
    seg.feed('\x1b[?1049h');

    expect(alt).toEqual([true]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config tests/vitest.config.ts tests/unit/blockSegmenterModeSignals.test.ts`
Expected: FAIL — `seg.onModeSignal is not a function`.

- [ ] **Step 3: Emit mode signals from BlockSegmenter**

In `src/components/BlockSegmenter.ts`:

Add the import:

```ts
import type { ModeSignal } from '@/utils/terminalMode';
```

Add the callback type near the other callback types (~line 33):

```ts
type ModeSignalCallback = (signal: ModeSignal) => void;
```

Add the callback array next to `_altScreenCallbacks` (~line 68) and the registrar next to `onAltScreen` (~line 134):

```ts
  private _modeSignalCallbacks: ModeSignalCallback[] = [];
```

```ts
  onModeSignal(cb: ModeSignalCallback): void { this._modeSignalCallbacks.push(cb); }
```

Add the emit helper next to `_setCommandActive`:

```ts
  private _emitModeSignal(signal: ModeSignal): void {
    this._modeSignalCallbacks.forEach(cb => cb(signal));
  }
```

Emit at each site, **alongside** the existing callback (do not replace anything in this task):

- In `_feedLegacy`, after `this._altScreenCallbacks.forEach(cb => cb(true));`:
  ```ts
      this._emitModeSignal({ kind: 'altScreen', entered: true });
  ```
- In `_feedLegacy`, after `this._altScreenCallbacks.forEach(cb => cb(false));`:
  ```ts
      this._emitModeSignal({ kind: 'altScreen', entered: false });
  ```
- In `_feedIntegrated`, after the alt-enter callback:
  ```ts
      this._emitModeSignal({ kind: 'altScreen', entered: true });
  ```
- In `_feedIntegrated`, after the alt-exit callback:
  ```ts
      this._emitModeSignal({ kind: 'altScreen', entered: false });
  ```
- In `_feedIntegrated`, in the `TUI_REPOSITION_RE` branch — emit `tuiHint`, **not** `altScreen`. This is the whole point: the regex is a guess and must be labelled as one:
  ```ts
    if (!this._inAltScreen && this._osc133Phase === 'output' && TUI_REPOSITION_RE.test(rawData)) {
      this._inAltScreen = true;
      this._altScreenCallbacks.forEach(cb => cb(true));
      // A cursor-reposition redraw is an inference, not an observation. It is
      // labelled as such so the resolver can let an authoritative signal
      // overrule it and so retention can refuse to drop bytes on a guess.
      this._emitModeSignal({ kind: 'tuiHint' });
    }
  ```
- In `_handleOsc133Marker`, at the top of each case, emit the phase:
  - case `'A'`: `this._emitModeSignal({ kind: 'osc133', phase: 'prompt' });` (place it after the existing phase assignment at the end of the case, so it reflects the settled phase)
  - case `'B'`: `this._emitModeSignal({ kind: 'osc133', phase: 'command' });`
  - case `'C'`: `this._emitModeSignal({ kind: 'osc133', phase: 'output' });` (after the early-return guard, so a stray Ptyxis C does not emit)
- In `_consumeOsc6973`, after each hook is parsed:
  ```ts
        if (parsed.hook === 'preexec') {
          this._pendingPreexec = { command: parsed.command };
          this._emitModeSignal({ kind: 'hook', hook: parsed });
        } else if (parsed.hook === 'precmd') {
          this._pendingPrecmd = { /* unchanged */ };
          this._emitModeSignal({ kind: 'hook', hook: parsed });
        }
  ```

Add `this._modeSignalCallbacks = [];` to `reset()` alongside the other callback-array clears.

- [ ] **Step 4: Run the signal test to verify it passes**

Run: `npx vitest run --config tests/vitest.config.ts tests/unit/blockSegmenterModeSignals.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Drive the resolver from TerminalSession**

In `src/components/TerminalSession.tsx`:

```ts
import { createModeResolver, type ModeState } from '@/utils/terminalMode';
```

Add the resolver ref and state next to the existing flags:

```ts
  const modeResolverRef = useRef(createModeResolver());
  const [modeState, setModeState] = useState<ModeState>(() => modeResolverRef.current.state);
```

In the segmenter-wiring effect, subscribe:

```ts
    segmenter.onModeSignal((signal) => {
      if (cancelled) return;
      setModeState(modeResolverRef.current.apply(signal));
    });
```

Feed termios into the resolver from `onEchoChange`, immediately after the recorder call added in Task 2:

```ts
      recorderRef.current.termios(e.icanon, e.echo);
      setModeState(modeResolverRef.current.apply({ kind: 'termios', icanon: e.icanon, echo: e.echo }));
```

Derive the three legacy flags from `modeState` so the observable surface is unchanged. Add this effect after the flag declarations:

```ts
  // Behaviour-neutral bridge: the resolver is now the single decider, but the
  // three legacy flags keep their exact current meaning so this step changes no
  // decisions. deriveInputSurface reads 'fullscreen' as
  // `altScreenVisible || (interactiveMode && interactiveFullscreen)` and
  // 'docked' as `interactiveMode`, so this mapping reproduces both branches.
  // The flags collapse into modeState in the next commit.
  useEffect(() => {
    setAltScreenVisible(modeState.inputOwner === 'fullscreen');
    setInteractiveMode(modeState.inputOwner === 'program' || modeState.inputOwner === 'fullscreen');
    setInteractiveFullscreen(modeState.inputOwner === 'fullscreen');
  }, [modeState]);
```

Reset the resolver in the effect cleanup, alongside `segmenter.reset()`:

```ts
      modeResolverRef.current.reset();
```

**Leave the 500ms debounce in place.** It still calls `setInteractiveMode(true)`; the effect above will re-derive on the next signal. Task 8 deletes it.

- [ ] **Step 6: Extend the replay harness to drive the resolver**

In `tests/helpers/replayPty.ts`, add the resolver so its transitions join the timeline:

```ts
import { createModeResolver } from '@/utils/terminalMode';
```

Inside `replayRecording`, alongside the segmenter:

```ts
  const resolver = createModeResolver();
  let lastMode = `${resolver.state.inputOwner}:${resolver.state.provenance}`;

  const pushMode = () => {
    const label = `${resolver.state.inputOwner}:${resolver.state.provenance}`;
    if (label !== lastMode) {
      lastMode = label;
      timeline.push({ t: now, label: `mode:${label}` });
    }
  };

  seg.onModeSignal(signal => { resolver.apply(signal); pushMode(); });
```

And in the `termios` case of the entry loop, after pushing the `termios:*` label:

```ts
        resolver.apply({ kind: 'termios', icanon: entry.icanon, echo: entry.echo });
        pushMode();
```

Add a test to `tests/unit/replayPty.test.ts`:

```ts
  it('reports resolver mode transitions in the timeline', () => {
    const rec = new PtyRecorder(() => 0);
    rec.data(osc133('A'));
    rec.data('$ ');
    rec.data(osc133('B'));
    rec.data('claude\n');
    rec.data(osc133('C'));
    rec.data('\x1b[2A');       // inferred flip
    rec.termios(false, true);  // authoritative confirmation

    const { transitions } = replayRecording(parseRecording(rec.serialize()));

    expect(transitions).toContain('mode:program:inferred');
    expect(transitions).toContain('mode:program:authoritative');
    expect(transitions.indexOf('mode:program:inferred'))
      .toBeLessThan(transitions.indexOf('mode:program:authoritative'));
  });
```

- [ ] **Step 7: Verify the corpus is unchanged**

Run: `npx vitest run --config tests/vitest.config.ts tests/unit/replayCorpus.test.ts`

Expected: **PASS with no snapshot updates**, except that the new `mode:*` labels now appear in the `transitions` arrays. Update those snapshots with `-u` and read the diff carefully: the `altScreen:*` and `interactive:*` labels and their **order** must be byte-identical to the baseline. Only `mode:*` entries may be added.

If an `altScreen:*` or `interactive:*` label changed, moved, or disappeared, this task is not neutral. Stop and fix the wiring rather than accepting the snapshot — the whole value of splitting Task 6/7 from Task 8 is this check.

- [ ] **Step 8: Typecheck and run the full suite**

Run: `npx tsc --noEmit && npm test`
Expected: tsc clean, suite green with no behavioural test changes.

- [ ] **Step 9: Commit**

```bash
git add src/components/BlockSegmenter.ts src/components/TerminalSession.tsx \
        tests/helpers/replayPty.ts tests/unit/replayPty.test.ts \
        tests/unit/blockSegmenterModeSignals.test.ts tests/unit/replayCorpus.test.ts
git commit -m "refactor(mode): route mode decisions through the resolver

Behaviour-neutral: the segmenter now emits tagged signals and the three
React flags are derived from one ModeState, but every decision is
unchanged and the replay timelines match the baseline. The regex flip is
relabelled tuiHint so it is visibly a guess. Rule changes land next.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 8: Apply the tier rules and remove the debounce

Rollout step 3, **second commit** — this is where behaviour changes, and it is the riskiest task in the plan.

The 500ms debounce at `TerminalSession.tsx:693` exists to paper over the race the resolver now settles. Combined with the poller's 200ms interval it puts the authoritative signal up to 700ms behind the two inferred ones. With `tuiHint` promoting immediately and termios overruling it authoritatively, the debounce is not merely redundant — it is actively wrong, because it delays the signal that is allowed to correct a bad guess.

**Files:**
- Modify: `src/components/TerminalSession.tsx` (delete the debounce, collapse the flags)
- Modify: `src/components/BlockSegmenter.ts` (delete `onAltScreen` / `onInteractiveMode` and their arrays)
- Modify: `tests/unit/replayCorpus.test.ts`, `tests/helpers/replayPty.ts`
- Modify: any existing test asserting on the removed callbacks

**Interfaces:**
- Consumes: everything from Tasks 6 and 7.
- Produces: `BlockSegmenter` no longer exposes `onAltScreen` or `onInteractiveMode`.

- [ ] **Step 1: Find every consumer of the callbacks being removed**

Run:
```bash
grep -rn "onAltScreen\|onInteractiveMode\|_altScreenCallbacks\|_interactiveCallbacks\|_inInteractiveMode\|_interactiveFullscreen" src tests
```

Write the list down. Every hit must be resolved in this task — there is no compatibility shim.

- [ ] **Step 2: Write the failing test**

Add to `tests/unit/terminalMode.test.ts`:

```ts
describe('rule changes (Task 8)', () => {
  it('an authoritative cooked-mode reading overrules a stale TUI guess immediately', () => {
    // The old debounce meant a false tuiHint owned the surface for up to 700ms.
    // Now the correction applies the moment termios speaks.
    const r = createModeResolver();
    r.apply({ kind: 'osc133', phase: 'output' });
    expect(r.apply({ kind: 'tuiHint' }).inputOwner).toBe('program');
    const st = r.apply({ kind: 'termios', icanon: true, echo: true });
    expect(st.inputOwner).toBe('shell');
    expect(st.provenance).toBe('authoritative');
  });

  it('a transient raw-mode blip is not filtered by a timer, only by later signals', () => {
    // `brew` briefly drops ICANON for a progress bar. The old code debounced it
    // away; now the flip happens and the restore corrects it. Both are
    // authoritative and neither drops output (see Task 9).
    expect(timeline([
      { kind: 'osc133', phase: 'output' },
      { kind: 'termios', icanon: false, echo: true },
      { kind: 'termios', icanon: true, echo: true },
    ])).toEqual(['shell:authoritative', 'program:authoritative', 'shell:authoritative']);
  });
});
```

- [ ] **Step 3: Run the test**

Run: `npx vitest run --config tests/vitest.config.ts tests/unit/terminalMode.test.ts -t "rule changes"`
Expected: PASS already — Task 6 implemented these rules. This test pins them as the *intended* behaviour before the debounce is removed, so its failure later is unambiguous. If it fails, fix Task 6's resolver before continuing.

- [ ] **Step 4: Remove the debounce**

In `src/components/TerminalSession.tsx`, replace the debounced `onEchoChange` body with the direct path:

```ts
    const cleanupEcho = window.tai?.pty?.onEchoChange?.((evtId: number, e: { echo: boolean; icanon: boolean; passwordPrompt: boolean; interactiveProgram: boolean }) => {
      if (cancelled) return;
      if (evtId !== ptyId) return;
      recorderRef.current.termios(e.icanon, e.echo);
      setPasswordPrompt(e.passwordPrompt);
      // No debounce. It existed to paper over the race between this signal and
      // the two byte-sniffing ones; the resolver settles that race by tier, so
      // delaying the authoritative signal now only delays the correction of a
      // bad guess. Transient raw-mode blips (brew's progress bar) are handled
      // by the restore signal, and no longer cost output — see the
      // provenance-gated retention in _routeChunk.
      setModeState(modeResolverRef.current.apply({ kind: 'termios', icanon: e.icanon, echo: e.echo }));
    });
```

Delete `echoInteractiveTimerRef` entirely: its declaration (~line 246), its entry in the timer-cleanup array (~line 120), the clears in the `onBlockActive` handler (~lines 668-671), and the clear in the effect cleanup (~lines 739-741). `grep -n echoInteractiveTimerRef src/components/TerminalSession.tsx` must return nothing.

In the `onBlockActive` handler, replace the now-orphaned `setInteractiveMode(false)` with a resolver signal, keeping the same intent (a finished block means the foreground is the shell again):

```ts
      } else {
        window.tai?.pty?.stopEchoPoll?.(ptyId);
        setPasswordPrompt(false);
        setModeState(modeResolverRef.current.apply({ kind: 'osc133', phase: 'prompt' }));
      }
```

- [ ] **Step 5: Collapse the three flags into modeState**

Delete the `altScreenVisible`, `interactiveMode`, `interactiveFullscreen` `useState` declarations, the derivation effect added in Task 7, and `interactiveModeRef` / `altScreenRef` if they have no remaining readers (check with grep — some are read by keyboard routing).

Replace each read site. The `deriveInputSurface` call (~line 1423) becomes:

```ts
  const surface = deriveInputSurface({
    altScreenVisible: modeState.inputOwner === 'fullscreen',
    interactiveMode: modeState.inputOwner === 'program' || modeState.inputOwner === 'fullscreen',
    interactiveFullscreen: modeState.inputOwner === 'fullscreen',
    awaitingInput,
    passwordPrompt,
    rootedSession: !!(activeSession?.rooted && hasActiveBlock),
    isWindows: window.tai?.system?.platform === 'win32',
    commandRunning: modeState.commandRunning,
  });
```

(`deriveInputSurface` keeps its signature — the spec is explicit that `inputSurface.ts` is already the right shape and the defect was one layer up. Its `isWindows` special case is removed in Task 10, not here.)

For the remaining read sites found in Step 1 — `showFullscreenInteractive` (~line 1562), the `'interactive'` mode string (~line 1580), the focus effect (~line 1417) — substitute the equivalent `modeState.inputOwner` check. Do not introduce a local alias variable that re-creates the old three-flag shape; the point is that there is one state now.

- [ ] **Step 6: Delete the legacy callbacks from BlockSegmenter**

In `src/components/BlockSegmenter.ts`, remove:
- the `AltScreenCallback` and `InteractiveModeCallback` types
- `_altScreenCallbacks`, `_interactiveCallbacks` and their `reset()` clears
- the `onAltScreen` and `onInteractiveMode` registrars
- every `this._altScreenCallbacks.forEach(...)` and `this._interactiveCallbacks.forEach(...)` call, leaving the `_emitModeSignal` calls added in Task 7

Keep `_inAltScreen`, `_inInteractiveMode`, and `_interactiveFullscreen` as internal fields for now — `_routeChunk` and `_truncateToCommandEcho` still read them. Task 9 replaces `_inAltScreen`'s role in routing.

In `tests/helpers/replayPty.ts`, remove the two now-deleted subscriptions and their timeline labels, leaving `mode:*` and `termios:*`.

- [ ] **Step 7: Run the full suite and triage**

Run: `npm test`

Expect failures in the corpus and in any test that asserted on the removed callbacks. For each:
- A test asserting on `onAltScreen` / `onInteractiveMode` directly: rewrite it against `onModeSignal`.
- A corpus snapshot whose `altScreen:*` / `interactive:*` labels vanished: expected — those labels no longer exist.
- A corpus snapshot whose `mode:*` sequence **changed**: this is the real signal. Read it. A `mode:program:inferred` that is now promptly followed by `mode:shell:authoritative` where it previously stayed `program` is the debounce removal working as designed. Update the snapshot and note the reason in a comment.
- A corpus snapshot where blocks changed: investigate before updating. Block content should not move in this task — that is Task 9's territory.

- [ ] **Step 8: Typecheck and confirm the greps are clean**

Run:
```bash
npx tsc --noEmit
grep -rn "echoInteractiveTimerRef\|onAltScreen\|onInteractiveMode" src tests
```
Expected: tsc clean; grep returns nothing.

- [ ] **Step 9: Run the full suite**

Run: `npm test`
Expected: green.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat(mode): apply tier rules, remove the 500ms echo debounce

The debounce papered over the race between termios and the two
byte-sniffing signals. The resolver settles that race by tier, so
delaying the authoritative signal now only delays correcting a bad
guess. Three React flags collapse into one ModeState.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 9: Provenance-gated retention

Rollout step 4 — this is the task that ends the silent data loss.

`_routeChunk` (`BlockSegmenter.ts:632`) returns early whenever `_inAltScreen` is set, discarding the chunk permanently. That is correct for a genuine alt-screen program: xterm.js renders it and the line emulator would only produce garbage. But the `TUI_REPOSITION_RE` guess sets the same flag, so **a false inference destroys output irrecoverably**.

**Invariant: mode decides rendering, never retention.** A wrong flip should cost an ugly card, never lost data.

**Files:**
- Modify: `src/components/BlockSegmenter.ts` (`_routeChunk`, add the side buffer, add `setModeState`)
- Modify: `src/components/TerminalSession.tsx` (push `ModeState` into the segmenter)
- Test: `tests/unit/blockSegmenterRetention.test.ts`

**Interfaces:**
- Consumes: `ModeState` from Task 6.
- Produces:
  ```ts
  // BlockSegmenter
  setModeState(state: ModeState): void;
  export const MAX_RETAINED_BYTES: number;   // 256 * 1024
  ```

**Rules:**
- `provenance: 'authoritative'` and owner is `'fullscreen'` → drop as today. Safe and intentional.
- `provenance: 'inferred'` → **retain to a bounded side buffer** (256KB, head-preserving, same shape as `MAX_OSC_PAYLOAD`). Rendering still routes to xterm, so behaviour is unchanged when the guess is right.
- If an authoritative signal later **contradicts** the guess, replay the retained bytes into `_outEmu` so the block recovers its output.
- If an authoritative signal **confirms** the guess, discard the buffer.
- `provenance: 'degraded'` inherits the retaining behaviour — no authoritative source means nothing is safe to drop. This falls out of gating the drop on `'authoritative'` rather than needing its own branch.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/blockSegmenterRetention.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { BlockSegmenter, MAX_RETAINED_BYTES } from '@/components/BlockSegmenter';
import type { ModeState } from '@/utils/terminalMode';

function osc133(letter: string) {
  return `\x1b]133;${letter}\x07`;
}

const INFERRED: ModeState = {
  inputOwner: 'program', provenance: 'inferred',
  passwordPrompt: false, commandRunning: true,
};
const AUTHORITATIVE_FULLSCREEN: ModeState = {
  inputOwner: 'fullscreen', provenance: 'authoritative',
  passwordPrompt: false, commandRunning: true,
};
const AUTHORITATIVE_SHELL: ModeState = {
  inputOwner: 'shell', provenance: 'authoritative',
  passwordPrompt: false, commandRunning: true,
};

/** Drive a block up to its output phase. */
function startBlock(seg: BlockSegmenter, command: string) {
  seg.feed(osc133('A'));
  seg.feed('$ ');
  seg.feed(osc133('B'));
  seg.feed(`${command}\n`);
  seg.feed(osc133('C'));
}

function finishBlock(seg: BlockSegmenter) {
  seg.feed(osc133('D;0'));
  seg.feed(osc133('A'));
  seg.feed('$ ');
  seg.feed(osc133('B'));
}

describe('provenance-gated retention', () => {
  it('recovers output when an authoritative signal contradicts an inferred flip', () => {
    const seg = new BlockSegmenter();
    const blocks: any[] = [];
    seg.onBlock(b => blocks.push(b));

    startBlock(seg, 'brew install foo');
    seg.setModeState(INFERRED);          // false TUI guess from a progress bar
    seg.feed('==> Downloading foo\n');
    seg.feed('==> Installing foo\n');
    seg.setModeState(AUTHORITATIVE_SHELL); // termios: it was cooked all along
    finishBlock(seg);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].output).toContain('Downloading foo');
    expect(blocks[0].output).toContain('Installing foo');
  });

  it('drops output under an authoritative fullscreen signal, as today', () => {
    const seg = new BlockSegmenter();
    const blocks: any[] = [];
    seg.onBlock(b => blocks.push(b));

    startBlock(seg, 'htop');
    seg.setModeState(AUTHORITATIVE_FULLSCREEN);
    seg.feed('full-screen redraw noise that belongs to xterm\n');
    seg.setModeState(AUTHORITATIVE_SHELL);
    finishBlock(seg);

    // Authoritative alt-screen: dropping is correct and stays.
    expect(blocks[0]?.output ?? '').not.toContain('redraw noise');
  });

  it('discards the side buffer when an authoritative signal confirms the guess', () => {
    const seg = new BlockSegmenter();
    const blocks: any[] = [];
    seg.onBlock(b => blocks.push(b));

    startBlock(seg, 'claude');
    seg.setModeState(INFERRED);
    seg.feed('TUI frame redraw\n');
    seg.setModeState({ ...INFERRED, provenance: 'authoritative' }); // confirmed program
    finishBlock(seg);

    // Confirmed: the retained frames are not replayed back into the block.
    expect(blocks[0]?.output ?? '').not.toContain('TUI frame redraw');
  });

  it('retains under degraded provenance, since nothing is safe to drop', () => {
    const seg = new BlockSegmenter();
    const blocks: any[] = [];
    seg.onBlock(b => blocks.push(b));

    startBlock(seg, 'something');
    seg.setModeState({
      inputOwner: 'program', provenance: 'degraded', degradedReason: 'no-termios',
      passwordPrompt: false, commandRunning: true,
    });
    seg.feed('output nobody can vouch for\n');
    seg.setModeState(AUTHORITATIVE_SHELL);
    finishBlock(seg);

    expect(blocks[0].output).toContain('output nobody can vouch for');
  });

  it('bounds the side buffer', () => {
    const seg = new BlockSegmenter();
    const blocks: any[] = [];
    seg.onBlock(b => blocks.push(b));

    startBlock(seg, 'noisy');
    seg.setModeState(INFERRED);
    seg.feed('x'.repeat(MAX_RETAINED_BYTES * 2));
    seg.setModeState(AUTHORITATIVE_SHELL);
    finishBlock(seg);

    expect(blocks[0].output.length).toBeLessThanOrEqual(MAX_RETAINED_BYTES + 1024);
  });

  it('caps retention at 256KB', () => {
    expect(MAX_RETAINED_BYTES).toBe(256 * 1024);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config tests/vitest.config.ts tests/unit/blockSegmenterRetention.test.ts`
Expected: FAIL — `seg.setModeState is not a function`.

- [ ] **Step 3: Implement retention**

In `src/components/BlockSegmenter.ts`:

Add the constant next to `MAX_OSC_PAYLOAD`:

```ts
// Bound on bytes retained while the mode is only inferred. Head-preserving,
// same shape as MAX_OSC_PAYLOAD.
export const MAX_RETAINED_BYTES = 256 * 1024;
```

Add the import and fields:

```ts
import { INITIAL_MODE_STATE, type ModeState } from '@/utils/terminalMode';
```

```ts
  private _modeState: ModeState = INITIAL_MODE_STATE;
  // Output captured while the mode was only a guess. Rendering already went to
  // xterm; this exists purely so a wrong guess costs an ugly card instead of
  // lost data.
  private _retained = '';
```

Add the setter, which is where recovery happens:

```ts
  /**
   * Push resolved mode state in.
   *
   * Mode decides rendering, never retention. While the mode is merely inferred
   * we keep a bounded copy of the bytes we are not routing into the block; if
   * an authoritative signal later contradicts the guess we replay them, and if
   * it confirms the guess we drop them. Before this, a false positive from the
   * cursor-reposition regex destroyed output irrecoverably.
   */
  setModeState(state: ModeState): void {
    const prev = this._modeState;
    this._modeState = state;

    if (prev.provenance !== 'authoritative' && state.provenance === 'authoritative') {
      const contradicted = state.inputOwner !== prev.inputOwner;
      if (contradicted && this._retained) {
        // The guess was wrong. Give the block its output back.
        this._outEmu.feed(this._retained);
        const clean = this._outEmu.tailText(STREAM_TAIL_LINES);
        if (clean.length > 0) {
          this._outputCallbacks.forEach(cb => cb(clean, this._outEmu.tailAnsi(STREAM_TAIL_LINES)));
        }
      }
      this._retained = '';
    }
  }
```

Replace the drop in `_routeChunk`:

```ts
  private _routeChunk(chunk: string): void {
    if (!this._integrationActive) return;
    // A genuine alt-screen program's bytes are full-screen TUI noise that
    // xterm.js renders and the line emulator can only mangle — dropping them is
    // correct. But only when we KNOW. Under a guess we still route rendering to
    // xterm, and keep a bounded copy so the guess is recoverable.
    if (this._inAltScreen) {
      if (this._modeState.provenance === 'authoritative') return;
      if (this._retained.length < MAX_RETAINED_BYTES) {
        this._retained += chunk.slice(0, MAX_RETAINED_BYTES - this._retained.length);
      }
      return;
    }
    switch (this._osc133Phase) {
      // ...unchanged
    }
  }
```

**Deviation from the spec, deliberate:** the spec says BlockSegmenter "deletes
`_inAltScreen`". This plan keeps it as an internal field and removes only its
*authority*. The reason is a real constraint: `ModeState` reaches the segmenter
through React state, so `setModeState` arrives on a later tick than the bytes
that triggered it. `_routeChunk` runs synchronously inside `feed()` and needs a
same-tick answer. `_inAltScreen` is now purely that local latch — it decides
*whether this chunk is drop-eligible*, and `_modeState.provenance` decides
*whether dropping is permitted*. Collapsing the two would reintroduce a race,
which is the bug class this project exists to remove.

Clear `_retained` at block boundaries — add to the `'A'` case in `_handleOsc133Marker`, next to `this._outEmu.reset();`:

```ts
        this._retained = '';
```

And to `reset()`:

```ts
    this._modeState = INITIAL_MODE_STATE;
    this._retained = '';
```

- [ ] **Step 4: Run the retention test**

Run: `npx vitest run --config tests/vitest.config.ts tests/unit/blockSegmenterRetention.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Push ModeState into the segmenter from TerminalSession**

In `src/components/TerminalSession.tsx`, every place that calls `modeResolverRef.current.apply(...)` must also inform the segmenter. Extract a helper next to the resolver ref:

```ts
  const applyModeSignal = useCallback((signal: ModeSignal) => {
    const next = modeResolverRef.current.apply(signal);
    segmenterRef.current.setModeState(next);
    setModeState(next);
  }, []);
```

Replace the three `setModeState(modeResolverRef.current.apply(...))` call sites (the `onModeSignal` subscription, the `onEchoChange` handler, and the `onBlockActive` else-branch) with `applyModeSignal(...)`.

Two different things are named `setModeState` here and it is worth keeping them
straight: `setModeState` bare is the React state setter from Task 7, while
`segmenterRef.current.setModeState` is the segmenter method added in this task.
`applyModeSignal` exists precisely so no other call site has to remember to call
both — a signal that updates one but not the other is exactly the kind of
divergence this project is removing.

Add the `ModeSignal` type to the existing import from `@/utils/terminalMode`.

- [ ] **Step 6: Run the corpus**

Run: `npx vitest run --config tests/vitest.config.ts tests/unit/replayCorpus.test.ts`

The `claude-ink` and `vite-shortcuts` fixtures are the ones to watch: output that was previously dropped after an inferred flip should now appear in the block when termios contradicts the guess. If a snapshot gains output, read it and confirm it is real output rather than TUI redraw noise — if it is noise, the resolver said `program:authoritative` and the retention branch should not have replayed. Update snapshots with `-u` and annotate:

```ts
    // Fixed by Task 9: output after the inferred flip is no longer discarded.
```

- [ ] **Step 7: Typecheck and run the full suite**

Run: `npx tsc --noEmit && npm test`
Expected: tsc clean, suite green.

- [ ] **Step 8: Commit**

```bash
git add src/components/BlockSegmenter.ts src/components/TerminalSession.tsx \
        tests/unit/blockSegmenterRetention.test.ts tests/unit/replayCorpus.test.ts
git commit -m "fix(segmenter): gate output retention on provenance

_routeChunk discarded chunks whenever _inAltScreen was set, including
when that flag came from the cursor-reposition regex — so a false
inference destroyed output irrecoverably. Bytes are now only dropped
under an authoritative signal; under a guess they are retained to a
bounded buffer and replayed if the guess is contradicted.

Mode decides rendering, never retention.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 10: Degraded mode

Rollout step 5 — the most user-visible change, landing last.

**Degraded is observed, never assumed.** The resolver does not ask "are we on Windows?" or "are we in SSH?". It asks whether an authoritative signal has been received for the current foreground context. Three special cases collapse into one code path, and it self-heals: if a remote host starts emitting OSC 133, hooks arrive and degraded clears itself. That is what makes a future Warpify push a drop-in with no resolver changes.

| Case | Today | After |
|---|---|---|
| No shell integration | partly tracked (`_integrationActive`, `hooksAvailable`) | `degraded: 'no-hooks'` |
| Remote SSH | untracked | `degraded: 'no-hooks'` |
| Windows / ConPTY | hardcoded in `inputSurface.ts` | `degraded: 'no-termios'` |

**Files:**
- Modify: `src/utils/terminalMode.ts` (degraded resolution)
- Modify: `src/utils/inputSurface.ts` (delete the Windows special case)
- Modify: `src/components/TerminalSession.tsx` (declare source availability; pass provenance)
- Modify: `src/components/BlockSegmenter.ts` (under-segmentation when degraded)
- Test: `tests/unit/terminalMode.test.ts`, `tests/unit/inputSurface.test.ts`, `tests/unit/blockSegmenterDegraded.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces:
  ```ts
  // terminalMode.ts — new signal member
  | { kind: 'sourceUnavailable'; source: 'termios' | 'hooks' }
  // ModeState.provenance may now be 'degraded' with a degradedReason
  // inputSurface.ts — InteractiveSignals loses isWindows, gains:
  degraded?: boolean;
  ```

**Behaviour when degraded (all four are required):**
1. **Retention is unconditional.** Already true — Task 9 gates the drop on `'authoritative'`, and `'degraded'` is not that.
2. **Classify from command shape, not from bytes.** Use `parseInteractiveSshCommand` and `classifySessionCommand` — knowable before execution and testable. This is what distinguishes `ssh host ls` (normal block) from `ssh host` (live surface).
3. **Under-segment rather than mis-segment.** A speculative prompt match does not split a block. This is a deliberate, user-visible change: some remote sessions produce fewer, larger blocks than today. A merged block is a cosmetic annoyance; output attributed to the wrong command is a lie that propagates into AI context, re-run, and session restore.
4. **Surface it.** A quiet chip reusing the existing `ShellIntegrationInstallCard` affordance.

- [ ] **Step 1: Write the failing resolver test**

Add to `tests/unit/terminalMode.test.ts`:

```ts
describe('degraded mode', () => {
  it('marks raw-mode decisions degraded when termios is unavailable', () => {
    const r = createModeResolver();
    r.apply({ kind: 'sourceUnavailable', source: 'termios' });
    r.apply({ kind: 'osc133', phase: 'output' });
    const st = r.apply({ kind: 'tuiHint' });
    expect(st.inputOwner).toBe('program');
    expect(st.provenance).toBe('degraded');
    expect(st.degradedReason).toBe('no-termios');
  });

  it('keeps alt-screen decisions authoritative when only termios is missing', () => {
    // Degradation is per-source, never global: Windows has no termios but
    // alt-screen escapes still arrive.
    const r = createModeResolver();
    r.apply({ kind: 'sourceUnavailable', source: 'termios' });
    const st = r.apply({ kind: 'altScreen', entered: true });
    expect(st.inputOwner).toBe('fullscreen');
    expect(st.provenance).toBe('authoritative');
    expect(st.degradedReason).toBeUndefined();
  });

  it('marks state degraded when hooks are unavailable', () => {
    const r = createModeResolver();
    r.apply({ kind: 'sourceUnavailable', source: 'hooks' });
    const st = r.apply({ kind: 'tuiHint' });
    expect(st.provenance).toBe('degraded');
    expect(st.degradedReason).toBe('no-hooks');
  });

  it('self-heals when the missing source starts reporting', () => {
    const r = createModeResolver();
    r.apply({ kind: 'sourceUnavailable', source: 'hooks' });
    expect(r.apply({ kind: 'tuiHint' }).provenance).toBe('degraded');

    // A remote host that gains integration starts emitting hooks. No resolver
    // change is needed for this to promote — that is what makes a future
    // Warpify push a drop-in.
    const st = r.apply({
      kind: 'hook',
      hook: { hook: 'precmd', exit: 0, signal: null, duration_ms: 1, command: 'x', cwd: '/' },
    });
    expect(st.provenance).toBe('authoritative');
    expect(st.degradedReason).toBeUndefined();
  });

  it('a termios reading clears a termios degradation', () => {
    const r = createModeResolver();
    r.apply({ kind: 'sourceUnavailable', source: 'termios' });
    const st = r.apply({ kind: 'termios', icanon: false, echo: true });
    expect(st.provenance).toBe('authoritative');
    expect(st.degradedReason).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config tests/vitest.config.ts tests/unit/terminalMode.test.ts -t "degraded"`
Expected: FAIL — the `sourceUnavailable` signal kind does not exist.

- [ ] **Step 3: Implement degraded resolution**

In `src/utils/terminalMode.ts`, extend the signal union:

```ts
  | { kind: 'sourceUnavailable'; source: 'termios' | 'hooks' }
```

Add availability tracking inside `createModeResolver`:

```ts
  // Degraded is OBSERVED, not assumed. We never ask "are we on Windows?" or
  // "are we in SSH?" — we ask whether an authoritative source has reported for
  // the current foreground context. That is what collapses three special cases
  // into one path, and what lets a session self-heal the moment a remote host
  // starts emitting hooks.
  const unavailable = new Set<'termios' | 'hooks'>();
```

Add the case:

```ts
      case 'sourceUnavailable': {
        unavailable.add(signal.source);
        return set(degrade(state));
      }
```

Add the helper inside the factory:

```ts
  /**
   * Per-source, never global. A missing termios does not make an alt-screen
   * escape any less of an observation, so a fullscreen decision stays
   * authoritative on Windows while a raw-mode decision does not.
   */
  function degrade(next: ModeState): ModeState {
    if (next.provenance === 'authoritative' && next.inputOwner === 'fullscreen') return next;
    if (unavailable.has('termios')) return { ...next, provenance: 'degraded', degradedReason: 'no-termios' };
    if (unavailable.has('hooks'))   return { ...next, provenance: 'degraded', degradedReason: 'no-hooks' };
    return next;
  }
```

Route the `tuiHint` result through it:

```ts
      case 'tuiHint': {
        if (authoritativeThisCommand) return state;
        if (state.inputOwner !== 'shell') return state;
        return set(degrade({ ...state, inputOwner: 'program', provenance: 'inferred' }));
      }
```

Clear the relevant source on a real reading — in the `termios` case, before returning:

```ts
        unavailable.delete('termios');
```

and in the `hook` case:

```ts
        unavailable.delete('hooks');
```

`set` spreads over the previous state, so a `degradedReason` set earlier survives
unless it is explicitly overwritten. Every case that resolves to
`provenance: 'authoritative'` must therefore carry `degradedReason: undefined`.
Task 6's `termios` and `altScreen` cases already do; add it to the **command
boundary** cases too — the `osc133` prompt/idle branch and the `hook` precmd
branch — since both set `provenance: 'authoritative'`:

```ts
        return set({
          inputOwner: 'shell',
          provenance: 'authoritative',
          degradedReason: undefined,
          commandRunning: false,
          passwordPrompt: false,
        });
```

Note the asymmetry, which is deliberate: an OSC 133 prompt marker is itself
proof that hooks are working, so it clears the degradation. A `tuiHint` is not
proof of anything, which is why it is the one case routed through `degrade()`.

Also clear the `unavailable` set in `reset()` and on `ptyExit`.

- [ ] **Step 4: Run the resolver test**

Run: `npx vitest run --config tests/vitest.config.ts tests/unit/terminalMode.test.ts`
Expected: PASS — the full file, including all earlier rule tests.

- [ ] **Step 5: Replace the Windows special case in inputSurface**

In `src/utils/inputSurface.ts`, remove `isWindows` from `InteractiveSignals` and add:

```ts
  /** No authoritative source is available for this context — see terminalMode's
   *  provenance. Formerly the `isWindows` special case; Windows (ConPTY) has no
   *  termios and no /proc, but so does an SSH session with no remote hooks, and
   *  so does a shell with no integration. All three are the same situation and
   *  now take the same path. */
  degraded?: boolean;
```

Replace the branch in `deriveInputSurface`:

```ts
  // Nothing authoritative is reporting, so any running command might be waiting
  // for input. Fall back to the live terminal instead of stranding the user on
  // the composer with no way to type into the foreground program.
  if (s.degraded && s.commandRunning) return 'docked';
```

Update `tests/unit/inputSurface.test.ts`: rename any `isWindows: true` to `degraded: true`. Add:

```ts
  it('falls back to docked whenever nothing authoritative is reporting', () => {
    expect(deriveInputSurface({
      altScreenVisible: false, interactiveMode: false, interactiveFullscreen: false,
      awaitingInput: false, passwordPrompt: false,
      degraded: true, commandRunning: true,
    })).toBe('docked');
  });

  it('stays on the composer when degraded but nothing is running', () => {
    expect(deriveInputSurface({
      altScreenVisible: false, interactiveMode: false, interactiveFullscreen: false,
      awaitingInput: false, passwordPrompt: false,
      degraded: true, commandRunning: false,
    })).toBe('composer');
  });
```

- [ ] **Step 6: Declare source availability from TerminalSession**

In `src/components/TerminalSession.tsx`:

Declare the termios gap on Windows, in the pty-wiring effect:

```ts
    // ConPTY exposes no termios and no /proc, so the authoritative raw-mode
    // signal will never arrive on this platform. Say so once rather than
    // special-casing the platform downstream.
    if (window.tai?.system?.platform === 'win32') {
      applyModeSignal({ kind: 'sourceUnavailable', source: 'termios' });
    }
```

Declare the hooks gap when an SSH session goes active without remote integration. The existing `useEffect` keyed on `sshSessionActive` / `sshSessionTarget` (the one that offers `ShellIntegrationInstallCard` after a couple of seconds without OSC 133) is the right host — it already has exactly this timing logic. In the branch where it decides no markers arrived, add:

```ts
      applyModeSignal({ kind: 'sourceUnavailable', source: 'hooks' });
```

Pass provenance into the surface:

```ts
    degraded: modeState.provenance === 'degraded',
```

replacing the `isWindows` line in the `deriveInputSurface` call.

- [ ] **Step 7: Write the under-segmentation test**

Create `tests/unit/blockSegmenterDegraded.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { BlockSegmenter } from '@/components/BlockSegmenter';
import type { ModeState } from '@/utils/terminalMode';

const DEGRADED: ModeState = {
  inputOwner: 'shell', provenance: 'degraded', degradedReason: 'no-hooks',
  passwordPrompt: false, commandRunning: true,
};

describe('degraded segmentation', () => {
  it('does not split a block on a speculative prompt match', () => {
    // A remote shell with no integration. `$` at the end of a line of output is
    // not proof of a prompt, and attributing the following output to a
    // fabricated command is a lie that propagates into AI context, re-run and
    // session restore. Under-segmenting is merely ugly.
    const seg = new BlockSegmenter();
    const blocks: any[] = [];
    seg.onBlock(b => blocks.push(b));
    seg.setModeState(DEGRADED);

    seg.feed('user@remote:~$ ');
    seg.feed('cat prices.txt\n');
    seg.feed('widget costs 5$\n');
    seg.feed('gadget costs 9$\n');

    // The `5$` line must not be treated as a prompt and split the block.
    expect(blocks.length).toBeLessThanOrEqual(1);
  });

  it('still segments normally when not degraded', () => {
    const seg = new BlockSegmenter();
    const blocks: any[] = [];
    seg.onBlock(b => blocks.push(b));

    seg.feed('user@host:~$ ');
    seg.feed('echo one\n');
    seg.feed('one\n');
    seg.feed('user@host:~$ ');

    expect(blocks).toHaveLength(1);
    expect(blocks[0].command).toBe('echo one');
  });
});
```

- [ ] **Step 8: Run the test to verify it fails**

Run: `npx vitest run --config tests/vitest.config.ts tests/unit/blockSegmenterDegraded.test.ts`
Expected: FAIL on the first test — the legacy prompt heuristic splits on the `5$` line.

- [ ] **Step 9: Implement under-segmentation**

In `src/components/BlockSegmenter.ts`, guard the speculative branch of `_checkForPrompt`. The first branch (a prompt match on the *partial* current line, i.e. the cursor is sitting after it) stays — that is a strong signal. The second branch, which matches a prompt on the **previous completed line** when the partial is empty, is the speculative one:

```ts
    if (row > 0 && partial === '') {
      // Under-segment rather than mis-segment. Matching a prompt on a completed
      // line is speculation: `widget costs 5$` looks exactly like a prompt to
      // PROMPT_RE. When nothing authoritative is reporting we have no way to
      // check, and a merged block is a cosmetic annoyance while output
      // attributed to the wrong command is a lie that propagates into AI
      // context, re-run and session restore.
      if (this._modeState.provenance === 'degraded') return;
      const lastLine = this._emu.textLines(false)[row - 1];
      // ...unchanged
    }
```

- [ ] **Step 10: Run the test to verify it passes**

Run: `npx vitest run --config tests/vitest.config.ts tests/unit/blockSegmenterDegraded.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 11: Surface degraded mode in the UI**

In `src/components/TerminalSession.tsx`, the `ShellIntegrationInstallCard` is already rendered for SSH targets that stay silent on OSC 133. Extend its trigger so it also covers the local no-integration case, by keying the existing card state on `modeState.degradedReason === 'no-hooks'` in addition to the current SSH condition.

Do not add a new component, a new modal, or a persistent banner. The spec asks for a quiet chip; the existing card is that affordance and reusing it keeps the surface area small. (Note: the `⥂` manual remote override referenced in earlier drafts was removed in `c379e3b` as superseded by the remote-AI pill — there is no manual override to point at.)

- [ ] **Step 12: Run the corpus**

Run: `npx vitest run --config tests/vitest.config.ts tests/unit/replayCorpus.test.ts`

`ssh-interactive` is the fixture that should move: fewer, larger blocks. Confirm the merge is the under-segmentation change and not a regression in the OSC 133 path (the local fixtures must be unaffected — they have hooks and are never degraded). Update with `-u` and annotate:

```ts
    // Changed by Task 10: remote sessions with no hooks now under-segment
    // rather than split on speculative prompt matches.
```

- [ ] **Step 13: Typecheck, grep, and run the full suite**

Run:
```bash
npx tsc --noEmit
grep -rn "isWindows" src/utils/inputSurface.ts
npm test
```
Expected: tsc clean; the grep returns nothing; suite green.

- [ ] **Step 14: Commit**

```bash
git add -A
git commit -m "feat(mode): observed degraded mode replacing three special cases

Degraded is observed, never assumed: the resolver asks whether an
authoritative source reported, not what platform this is. No-integration,
remote SSH and Windows/ConPTY collapse into one path that self-heals when
hooks appear — which is what makes a future Warpify push a drop-in.

Under-segments rather than mis-segments when degraded. Some remote
sessions now produce fewer, larger blocks; output attributed to the wrong
command is a worse failure than a merged card.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 11: Manual verification

The corpus cannot cover focus, keystroke echo, or scroll feel — no recording can. **This task requires a human.**

Task 8's rule changes are the risky part: they alter timing-sensitive behaviour that had ad-hoc compensation scattered around it. Some of that compensation became redundant and some became actively wrong. Expect one or two follow-up fixes after real use; the corpus makes them cheap to pin down.

**Files:** none (verification only, plus any fixes it surfaces).

- [ ] **Step 1: Build and run**

Run: `npm run build && npm run dev`
Expected: build clean.

- [ ] **Step 2: Walk the matrix**

In each of **zsh + p10k**, **bash**, and **fish**, run each of: `claude`, `vite` (in a project with it), `python3`, `htop`, an interactive `ssh` to a real host, and `sudo true`.

For each, check:
- Keystrokes echo where you type them, and focus lands on the right surface.
- The card does not flicker between surfaces on launch or exit.
- Output is not missing from the finished block.
- The surface returns to the composer when the program exits.

- [ ] **Step 3: Capture a recording for anything that misbehaves**

Save a PTY recording immediately (the ring holds ~1MB, so do it before scrolling on). Add it to `tests/fixtures/pty/`, scrub it per the README, write a failing replay test, then fix.

This is the payoff of Task 1: a bug seen once is now permanently reproducible.

- [ ] **Step 4: Confirm the zsh gate does not apply**

Run: `git diff master --stat -- electron/shell-integration/`
Expected: **empty**. This project changes no shell integration scripts, so the hard real-zsh verification gate from the ZDOTDIR work does not re-trigger. If this diff is non-empty, something went wrong — stop and investigate.

- [ ] **Step 5: Report**

Report what was verified, what moved, and any follow-up fixes made. Do not mark the project complete while a scenario in the matrix is still misbehaving — say which one and why instead.

---

## Rollback

No feature flag, per the spec: the steps are small enough that `git revert` is the rollback, and a flag in this layer would become another source of divergent behaviour — the exact problem this project exists to remove.

Task boundaries are the revert points. Task 8 (rule changes) and Task 10 (under-segmentation) are the two that alter user-visible behaviour; each is a single commit and reverts cleanly on its own.
