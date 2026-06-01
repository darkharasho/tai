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

  it('strips carriage returns before newlines', () => {
    expect(stripAnsi('line1\r\nline2')).toBe('line1\nline2');
  });

  it('preserves bare carriage returns for line overwriting', () => {
    expect(stripAnsi('old text\rnew prompt$ ')).toBe('old text\rnew prompt$ ');
  });

  it('preserves plain text', () => {
    expect(stripAnsi('hello world')).toBe('hello world');
  });

  it('handles alt-screen sequences within mixed content', () => {
    expect(stripAnsi('\x1b[?1049hhello')).toBe('hello');
  });

  it('rewrites cursor-to-col-1 escapes (ESC[G, ESC[0G, ESC[1G) as \\r', () => {
    // Python/node readline emit these for redrawing the prompt line instead
    // of a bare \r; we normalize so per-line CR collapse can see the redraw.
    expect(stripAnsi('\x1b[G>>> 1+1')).toBe('\r>>> 1+1');
    expect(stripAnsi('\x1b[0G>>> 1+1')).toBe('\r>>> 1+1');
    expect(stripAnsi('\x1b[1G>>> 1+1')).toBe('\r>>> 1+1');
  });

  it('combined readline redraw pattern collapses with CR semantics', () => {
    // Simulates python readline emitting cursor-col1 + erase-to-EOL on each
    // keystroke. stripAnsi rewrites the col-1 escape; downstream applyCR can
    // then keep only post-last-\r content per line.
    const bytes = '>>> \x1b[G\x1b[K>>> 1\x1b[G\x1b[K>>> 1+\x1b[G\x1b[K>>> 1+1\n2\n>>> ';
    // \x1b[G → \r ; \x1b[K is stripped. So each redraw becomes "\r>>> <buf>".
    expect(stripAnsi(bytes)).toBe('>>> \r>>> 1\r>>> 1+\r>>> 1+1\n2\n>>> ');
  });
});
