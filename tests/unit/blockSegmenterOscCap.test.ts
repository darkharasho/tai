import { describe, it, expect } from 'vitest';
import { BlockSegmenter, MAX_OSC_PAYLOAD } from '@/components/BlockSegmenter';
import { pathological } from '../fixtures/pathological';

// Helper: activate OSC-133 integration mode so _routeChunk actually accumulates.
// Send an OSC 133 A marker (prompt-start) to set _integrationActive = true and
// _osc133Phase = 'prompt', then feed the pathological payload.
const OSC133_A = '\x1b]133;A\x07';

describe('BlockSegmenter OSC/DCS payload cap', () => {
  it('exports MAX_OSC_PAYLOAD as a positive number', () => {
    expect(typeof MAX_OSC_PAYLOAD).toBe('number');
    expect(MAX_OSC_PAYLOAD).toBeGreaterThan(0);
  });

  it('does not retain an unbounded OSC payload in _osc133RawPrompt', () => {
    const seg = new BlockSegmenter();
    // Activate integration and set phase to 'prompt'
    seg.feed(OSC133_A);
    // Feed a huge unterminated OSC 6973 payload (200 KB); it survives _consumeOsc6973
    // (no terminator → no match) and lands in _routeChunk → _osc133RawPrompt.
    expect(() => seg.feed(pathological.unterminatedOsc)).not.toThrow();
    const raw: string = (seg as any)._osc133RawPrompt ?? '';
    expect(raw.length).toBeLessThanOrEqual(MAX_OSC_PAYLOAD + 16);
  });

  it('does not retain an unbounded OSC payload in _osc133RawCommand', () => {
    const seg = new BlockSegmenter();
    // A → prompt phase, B → command phase
    seg.feed('\x1b]133;A\x07');
    seg.feed('\x1b]133;B\x07');
    expect(() => seg.feed(pathological.unterminatedOsc)).not.toThrow();
    const raw: string = (seg as any)._osc133RawCommand ?? '';
    expect(raw.length).toBeLessThanOrEqual(MAX_OSC_PAYLOAD + 16);
  });

  it('does not throw on unterminatedOsc fixture', () => {
    const seg = new BlockSegmenter();
    expect(() => seg.feed(pathological.unterminatedOsc)).not.toThrow();
  });
});
