import { describe, it, expect } from 'vitest';
import { predictCommand, predictCommandIndexed } from '@/hooks/useGhostText';
import { createIndex, ingestBlock } from '@/utils/commandIndex';

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

describe('predictCommandIndexed', () => {
  it('returns the cwd-local frecency winner for a prefix', () => {
    const now = 1_000_000;
    const idx = createIndex();
    for (let i = 0; i < 3; i++) ingestBlock(idx, { command: 'docker compose up', cwd: '/svc', ts: now });
    ingestBlock(idx, { command: 'docker ps', cwd: '/other', ts: now });
    expect(predictCommandIndexed('docker ', idx, now, '/svc')).toBe('docker compose up');
  });
  it('returns null when nothing matches', () => {
    expect(predictCommandIndexed('zzz', createIndex(), 1)).toBeNull();
  });
});

describe('ghost text casing', () => {
  it('does not offer a candidate that only matches case-insensitively', () => {
    // The overlay draws the typed text plus the remainder, so this would render
    // as `cd documents/GitHub/tai/` — a path that does not exist.
    const idx = createIndex();
    ingestBlock(idx, { command: 'cd Documents/GitHub/tai/', ts: Date.now() });
    expect(predictCommandIndexed('cd docu', idx, Date.now())).toBeNull();
  });

  it('still offers a candidate once the casing matches', () => {
    const idx = createIndex();
    ingestBlock(idx, { command: 'cd Documents/GitHub/tai/', ts: Date.now() });
    expect(predictCommandIndexed('cd Docu', idx, Date.now())).toBe('cd Documents/GitHub/tai/');
  });
});
