import { describe, it, expect } from 'vitest';
import { isMultilineCommand } from '@/utils/isMultilineCommand';

describe('isMultilineCommand', () => {
  it('treats a trailing newline as single-line', () => {
    // The input box submits "<command>\n"; that trailing newline is the
    // submit marker, not multi-line content. Regression: previously this
    // was flagged as multi-line, which skipped creating the pending
    // command card and dropped all live-streaming output updates.
    expect(isMultilineCommand('for i in 1 2 3; do echo $i; done\n')).toBe(false);
  });

  it('treats multiple trailing newlines as single-line', () => {
    expect(isMultilineCommand('ls\n\n\n')).toBe(false);
  });

  it('returns false for a plain single-line command', () => {
    expect(isMultilineCommand('ls -la')).toBe(false);
  });

  it('returns false for empty input', () => {
    expect(isMultilineCommand('')).toBe(false);
  });

  it('detects interior newlines as multi-line', () => {
    expect(isMultilineCommand('echo one\necho two')).toBe(true);
  });

  it('detects interior newlines even with a trailing newline', () => {
    expect(isMultilineCommand('echo one\necho two\n')).toBe(true);
  });
});
