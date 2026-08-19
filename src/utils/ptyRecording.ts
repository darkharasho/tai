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
