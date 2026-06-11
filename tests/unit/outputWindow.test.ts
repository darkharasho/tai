import { describe, it, expect } from 'vitest';
import { headLines, tailLines } from '@/utils/outputWindow';

const text = Array.from({ length: 10 }, (_, i) => `line${i + 1}`).join('\n');

describe('headLines', () => {
  it('returns the full text with zero hidden when under the limit', () => {
    expect(headLines(text, 20)).toEqual({ text, hidden: 0 });
  });

  it('returns the first N lines and counts the rest as hidden', () => {
    expect(headLines(text, 3)).toEqual({ text: 'line1\nline2\nline3', hidden: 7 });
  });

  it('handles empty input', () => {
    expect(headLines('', 5)).toEqual({ text: '', hidden: 0 });
  });
});

describe('tailLines', () => {
  it('returns the full text with zero hidden when under the limit', () => {
    expect(tailLines(text, 20)).toEqual({ text, hidden: 0 });
  });

  it('returns the last N lines and counts the rest as hidden', () => {
    expect(tailLines(text, 2)).toEqual({ text: 'line9\nline10', hidden: 8 });
  });

  it('keeps ANSI styling within the kept lines intact', () => {
    const styled = 'plain\n\x1b[31mred\x1b[0m\nlast';
    expect(tailLines(styled, 2)).toEqual({ text: '\x1b[31mred\x1b[0m\nlast', hidden: 1 });
  });
});
