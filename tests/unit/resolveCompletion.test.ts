// tests/unit/resolveCompletion.test.ts
import { describe, it, expect } from 'vitest';
import { resolveCompletion, tokenize, CompletionSpec } from '@/completions/resolveCompletion';

const git: CompletionSpec = {
  command: 'git',
  subcommands: [
    { name: 'checkout', description: 'Switch branches' },
    { name: 'cherry-pick', description: 'Apply commits' },
    { name: 'commit', description: 'Record changes', options: [
      { names: ['-m', '--message'], description: 'Commit message', takesArg: true },
      { names: ['--amend'], description: 'Amend previous commit' },
    ] },
  ],
  options: [{ names: ['--version'], description: 'Print version' }],
};

describe('tokenize', () => {
  it('splits the line and isolates the partial last token', () => {
    expect(tokenize('git ch')).toEqual({ tokens: ['git'], lastToken: 'ch' });
    expect(tokenize('git commit ')).toEqual({ tokens: ['git', 'commit'], lastToken: '' });
  });
});

describe('resolveCompletion', () => {
  it('completes subcommands by prefix with descriptions', () => {
    const { tokens, lastToken } = tokenize('git ch');
    const r = resolveCompletion(git, tokens, lastToken);
    expect(r.items.map(i => i.value)).toEqual(['checkout', 'cherry-pick']);
    expect(r.items[0].description).toBe('Switch branches');
  });

  it('completes a subcommand-specific flag', () => {
    const { tokens, lastToken } = tokenize('git commit -');
    const r = resolveCompletion(git, tokens, lastToken);
    expect(r.items.map(i => i.value)).toEqual(expect.arrayContaining(['-m', '--message', '--amend']));
  });

  it('offers all subcommands when nothing typed after the command', () => {
    const { tokens, lastToken } = tokenize('git ');
    const r = resolveCompletion(git, tokens, lastToken);
    expect(r.items.map(i => i.value)).toEqual(['checkout', 'cherry-pick', 'commit']);
  });

  it('returns empty items at a positional/path token (defer to compgen)', () => {
    const { tokens, lastToken } = tokenize('git commit -m ');
    const r = resolveCompletion(git, tokens, lastToken);
    expect(r.items).toHaveLength(0);
  });
});
