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

  it('cwd boost requires matching cwd representation (symlink vs resolved)', () => {
    // This test locks the contract: ingest with a symlink path and rank with
    // the resolved (canonical) path — they must match for the cwd boost to
    // fire. If ingest and predictor use different path forms (e.g.
    // /var/home/user vs /home/user), cwdCounts[predictorCwd] always misses
    // and the cwd-local command never wins.
    const idx = createIndex();
    const SYMLINK_CWD = '/var/home/user/project';   // e.g. $PWD (unresolved)
    const RESOLVED_CWD = '/home/user/project';       // e.g. /proc/<pid>/cwd

    // Ingest 'npm run dev' twice in SYMLINK_CWD (as if stored with raw $PWD)
    ingestBlock(idx, { command: 'npm run dev', ts: NOW, cwd: SYMLINK_CWD });
    ingestBlock(idx, { command: 'npm run dev', ts: NOW, cwd: SYMLINK_CWD });
    // Ingest 'npm run build' more times globally (no cwd)
    for (let i = 0; i < 5; i++) ingestBlock(idx, { command: 'npm run build', ts: NOW - 1000 });

    // Ranking with SYMLINK_CWD matches: 'npm run dev' wins via cwd boost.
    expect(rankPrefix(idx, 'npm run', NOW, SYMLINK_CWD)[0]).toBe('npm run dev');

    // Ranking with RESOLVED_CWD (predictor form) MISSES the cwd-counts bucket:
    // 'npm run build' wins on raw frequency, exposing the mismatch bug.
    // The fix (ingest via getCwd so both sides use RESOLVED_CWD) would cause
    // cwdCounts[RESOLVED_CWD] to be populated and 'npm run dev' to win again.
    // We document the BEFORE state here so a regression is visible if someone
    // reverts the normalization in TerminalSession.tsx.
    const rankedWithResolved = rankPrefix(idx, 'npm run', NOW, RESOLVED_CWD);
    // Without normalization: cwd boost misses, frequency wins → 'npm run build' ranks first.
    expect(rankedWithResolved[0]).toBe('npm run build');

    // And with matching resolved-form ingestion, the boost fires correctly:
    const idx2 = createIndex();
    ingestBlock(idx2, { command: 'npm run dev', ts: NOW, cwd: RESOLVED_CWD });
    ingestBlock(idx2, { command: 'npm run dev', ts: NOW, cwd: RESOLVED_CWD });
    for (let i = 0; i < 5; i++) ingestBlock(idx2, { command: 'npm run build', ts: NOW - 1000 });
    expect(rankPrefix(idx2, 'npm run', NOW, RESOLVED_CWD)[0]).toBe('npm run dev');
  });
});
