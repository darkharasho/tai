import { describe, it, expect } from 'vitest';
import { predictCommand } from '@/hooks/useGhostText';

describe('predictCommand', () => {
  it('returns null for empty prefix', () => {
    expect(predictCommand('', ['ls', 'git status'])).toBeNull();
  });

  it('matches prefix case-insensitively', () => {
    expect(predictCommand('gi', ['git status', 'git log', 'ls'])).toBe('git status');
  });

  it('scores by frequency and recency', () => {
    const history = ['git log', 'git status', 'git log', 'git status', 'git status'];
    expect(predictCommand('git', history)).toBe('git status');
  });

  it('returns null when no match', () => {
    expect(predictCommand('xyz', ['ls', 'git'])).toBeNull();
  });

  it('does not match exact duplicates', () => {
    expect(predictCommand('ls', ['ls', 'ls -la'])).toBe('ls -la');
  });
});
