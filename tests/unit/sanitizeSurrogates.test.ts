import { describe, it, expect } from 'vitest';
import { stripLoneSurrogates } from '../../src/utils/sanitizeSurrogates';

describe('stripLoneSurrogates', () => {
  it('leaves plain ASCII untouched', () => {
    expect(stripLoneSurrogates('hi how are you')).toBe('hi how are you');
  });

  it('preserves valid surrogate pairs (emoji)', () => {
    const wolf = '🐺'; // 🐺
    expect(stripLoneSurrogates(`box ${wolf} ok`)).toBe(`box ${wolf} ok`);
  });

  it('replaces a lone high surrogate (e.g. emoji split by slice) with U+FFFD', () => {
    const loneHigh = 'abc\uD83D'; // high surrogate, no low — as left by str.slice mid-pair
    expect(stripLoneSurrogates(loneHigh)).toBe('abc�');
  });

  it('replaces a lone low surrogate with U+FFFD', () => {
    expect(stripLoneSurrogates('\uDC3Axyz')).toBe('�xyz');
  });

  it('replaces a high surrogate followed by a non-low char', () => {
    expect(stripLoneSurrogates('\uD83Da')).toBe('�a');
  });

  it('handles multiple valid pairs and lone surrogates mixed', () => {
    const ok = '😀'; // 😀
    expect(stripLoneSurrogates(`${ok}\uD83Dmid${ok}`)).toBe(`${ok}�mid${ok}`);
  });

  it('the result is round-trippable through JSON (no invalid escapes)', () => {
    const dirty = 'cmd output \uD83D truncated';
    const clean = stripLoneSurrogates(dirty);
    // JSON.parse(JSON.stringify(x)) must equal x — a lone surrogate would survive
    // stringify but is exactly what the API rejects; after sanitizing it's gone.
    expect(JSON.parse(JSON.stringify(clean))).toBe(clean);
    expect(clean.includes('\uD83D')).toBe(false);
  });
});
