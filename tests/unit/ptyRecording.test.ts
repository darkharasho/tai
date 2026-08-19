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
