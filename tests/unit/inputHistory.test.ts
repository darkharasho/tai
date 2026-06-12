import { describe, it, expect } from 'vitest';
import { assembleInputHistory } from '@/utils/inputHistory';

describe('assembleInputHistory', () => {
  it('drops blank and whitespace-only entries', () => {
    expect(assembleInputHistory(['ls', '', '  '], ['', 'pwd'])).toEqual(['ls', 'pwd']);
  });

  it('collapses consecutive duplicates', () => {
    expect(assembleInputHistory(['ls', 'ls', 'pwd'], ['pwd', 'ls'])).toEqual(['ls', 'pwd', 'ls']);
  });

  it('keeps base history before session history', () => {
    expect(assembleInputHistory(['old'], ['new'])).toEqual(['old', 'new']);
  });

  it('drops multi-line framed prompts (they are not retypeable commands)', () => {
    expect(assembleInputHistory([], ['The user has a long-running process\n```\nlog\n```\nwhy?', 'echo hi']))
      .toEqual(['echo hi']);
  });

  it('drops segmentation garbage recorded by older versions', () => {
    expect(assembleInputHistory([], [
      'piclock@piclock ~/axitools ❯❯❯  ✘ 130 piclock@piclock ~/axitools ❯❯❯',
      'cmdand heredoc> from collections import Counter',
      'heredoc> EOF',
      'user@host:~$ ls',
      'ding\x07dong',
      'git status',
    ])).toEqual(['git status']);
  });

  it('keeps real commands that merely look unusual', () => {
    expect(assembleInputHistory([], [
      '> truncate-me.txt',
      'echo "a > b"',
      '# a comment',
      'curl -s https://x.dev | jq .',
    ])).toEqual(['> truncate-me.txt', 'echo "a > b"', '# a comment', 'curl -s https://x.dev | jq .']);
  });
});
