// tests/unit/commandIndexRank.test.ts
import { describe, it, expect } from 'vitest';
import { createIndex, ingestBlock, rankPrefix, topNext, frecency } from '@/utils/commandIndex';

const NOW = 1_000_000_000;

describe('frecency ranking', () => {
  it('ranks a more frequent command above a rarer one for the same prefix', () => {
    const idx = createIndex();
    for (let i = 0; i < 5; i++) ingestBlock(idx, { command: 'git status', ts: NOW - 1000 });
    ingestBlock(idx, { command: 'git stash', ts: NOW - 1000 });
    expect(rankPrefix(idx, 'git st', NOW)[0]).toBe('git status');
  });

  it('cwd boost flips ranking toward the command run in this directory', () => {
    const idx = createIndex();
    for (let i = 0; i < 4; i++) ingestBlock(idx, { command: 'npm run build', ts: NOW - 1000, cwd: '/other' });
    ingestBlock(idx, { command: 'npm run dev', ts: NOW - 1000, cwd: '/proj' });
    ingestBlock(idx, { command: 'npm run dev', ts: NOW - 1000, cwd: '/proj' });
    expect(rankPrefix(idx, 'npm run d', NOW, '/proj')[0]).toBe('npm run dev');
  });

  it('recent beats old at equal frequency', () => {
    const idx = createIndex();
    ingestBlock(idx, { command: 'make old', ts: NOW - 1000 * 60 * 60 * 24 * 30 });
    ingestBlock(idx, { command: 'make new', ts: NOW - 1000 });
    expect(rankPrefix(idx, 'make', NOW)[0]).toBe('make new');
  });

  it('excludes the command exactly equal to the prefix', () => {
    const idx = createIndex();
    ingestBlock(idx, { command: 'ls', ts: NOW });
    expect(rankPrefix(idx, 'ls', NOW)).not.toContain('ls');
  });

  it('topNext returns the most common follow-ups', () => {
    const idx = createIndex();
    ingestBlock(idx, { command: 'git commit', ts: 1, prevCommand: 'git add .' });
    ingestBlock(idx, { command: 'git commit', ts: 2, prevCommand: 'git add .' });
    ingestBlock(idx, { command: 'git diff', ts: 3, prevCommand: 'git add .' });
    expect(topNext(idx, 'git add .', 2)).toEqual(['git commit', 'git diff']);
  });

  it('frecency is higher for cwd-local commands', () => {
    const idx = createIndex();
    ingestBlock(idx, { command: 'x', ts: NOW, cwd: '/here' });
    const s = idx.stats['x'];
    expect(frecency(s, NOW, '/here')).toBeGreaterThan(frecency(s, NOW, '/elsewhere'));
  });
});
