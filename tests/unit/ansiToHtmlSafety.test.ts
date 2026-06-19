// tests/unit/ansiToHtmlSafety.test.ts
import { describe, it, expect } from 'vitest';
import { ansiToHtml } from '@/utils/ansiToHtml';
import { pathological } from '../fixtures/pathological';

describe('ansiToHtml malformed-SGR safety', () => {
  // ESC[38;5m is a truncated 256-color sequence (missing the colour index).
  // With consumed=1 the sub-type byte `5` leaks back into the SGR loop.
  // With consumed=2 the `5` is skipped, so no styling should bleed through.
  it('truncated ESC[38;5m does not leak the sub-type byte as a standalone SGR', () => {
    const out = ansiToHtml('\x1b[38;5mhello');
    // SGR 5 = blink (not rendered by this renderer, so no style attribute at all)
    // The text should appear unstyled — no <span> wrapping it.
    expect(out).not.toContain('<span');
    expect(out).toContain('hello');
  });

  // ESC[38;2m is a truncated RGB sequence (missing R, G, B components).
  // With consumed=1 the sub-type byte `2` leaks back and sets dim → opacity:0.6.
  // With consumed=2 the `2` is skipped and no dim styling is emitted.
  it('truncated ESC[38;2m does not leak the sub-type byte as dim (opacity:0.6)', () => {
    const out = ansiToHtml('\x1b[38;2mhello');
    expect(out).not.toContain('opacity:0.6');
    expect(out).toContain('hello');
  });

  // ESC[48;5;m — trailing semicolon makes the split yield a 0 byte for the index.
  // Index 0 is valid (maps to --ansi-30/black), so a background span IS emitted.
  // What must NOT happen is a NaN being serialised into the output.
  it('ESC[48;5;m with trailing semicolon does not emit NaN into the output', () => {
    const out = ansiToHtml('\x1b[48;5;mhello');
    expect(out).not.toContain('NaN');
    expect(out).toContain('hello');
  });

  it('does not throw on nested-SGR or binary spew', () => {
    expect(() => ansiToHtml(pathological.nestedSgr)).not.toThrow();
    expect(() => ansiToHtml(pathological.binarySpew)).not.toThrow();
  });
});
