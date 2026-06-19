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
