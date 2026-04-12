import { describe, it, expect } from 'vitest';
import { stripAnsi } from '@/utils/stripAnsi';

describe('stripAnsi', () => {
  it('removes CSI color sequences', () => {
    expect(stripAnsi('\x1b[32mgreen\x1b[0m')).toBe('green');
  });

  it('removes OSC sequences', () => {
    expect(stripAnsi('\x1b]0;title\x07text')).toBe('text');
  });

  it('removes cursor movement sequences', () => {
    expect(stripAnsi('\x1b[2Jhello\x1b[H')).toBe('hello');
  });

  it('strips carriage returns', () => {
    expect(stripAnsi('line1\r\nline2')).toBe('line1\nline2');
  });

  it('preserves plain text', () => {
    expect(stripAnsi('hello world')).toBe('hello world');
  });

  it('handles alt-screen sequences within mixed content', () => {
    expect(stripAnsi('\x1b[?1049hhello')).toBe('hello');
  });
});
