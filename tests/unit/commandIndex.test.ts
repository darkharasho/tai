// tests/unit/commandIndex.test.ts
import { describe, it, expect } from 'vitest';
import { createIndex, ingestBlock, ingestHistoryLines, capIndex, MAX_INDEX_COMMANDS, shouldIndexBlock } from '@/utils/commandIndex';

describe('commandIndex ingestion', () => {
  it('counts repeated commands and records cwd buckets', () => {
    const idx = createIndex();
    ingestBlock(idx, { command: 'git status', cwd: '/a', ts: 1 });
    ingestBlock(idx, { command: 'git status', cwd: '/a', ts: 2 });
    ingestBlock(idx, { command: 'git status', cwd: '/b', ts: 3 });
    const s = idx.stats['git status'];
    expect(s.count).toBe(3);
    expect(s.lastTs).toBe(3);
    expect(s.cwdCounts['/a']).toBe(2);
    expect(s.cwdCounts['/b']).toBe(1);
  });

  it('records next-command adjacency from prevCommand', () => {
    const idx = createIndex();
    ingestBlock(idx, { command: 'git commit', ts: 2, prevCommand: 'git add .' });
    ingestBlock(idx, { command: 'git commit', ts: 4, prevCommand: 'git add .' });
    expect(idx.next['git add .']['git commit']).toBe(2);
  });

  it('records lastExitCode', () => {
    const idx = createIndex();
    ingestBlock(idx, { command: 'false', ts: 1, exitCode: 1 });
    expect(idx.stats['false'].lastExitCode).toBe(1);
  });

  it('ingests history lines with count 1 and no cwd', () => {
    const idx = createIndex();
    ingestHistoryLines(idx, ['ls', 'ls', 'pwd'], 10);
    expect(idx.stats['ls'].count).toBe(2);
    expect(idx.stats['pwd'].count).toBe(1);
    expect(idx.stats['ls'].cwdCounts).toEqual({});
  });

  it('caps total commands to MAX_INDEX_COMMANDS keeping highest count', () => {
    const idx = createIndex();
    for (let i = 0; i < MAX_INDEX_COMMANDS + 50; i++) ingestBlock(idx, { command: `c${i}`, ts: i });
    ingestBlock(idx, { command: 'keep-me', ts: 999999 });
    for (let k = 0; k < 20; k++) ingestBlock(idx, { command: 'keep-me', ts: 999999 });
    capIndex(idx, 1_000_000);
    expect(Object.keys(idx.stats).length).toBeLessThanOrEqual(MAX_INDEX_COMMANDS);
    expect(idx.stats['keep-me']).toBeTruthy();
  });
});

describe('shouldIndexBlock', () => {
  it('returns false for remote blocks', () => {
    expect(shouldIndexBlock({ isRemote: true, command: 'ls' })).toBe(false);
  });

  it('returns false for empty command', () => {
    expect(shouldIndexBlock({ isRemote: false, command: '' })).toBe(false);
    expect(shouldIndexBlock({ isRemote: false, command: '   ' })).toBe(false);
  });

  it('returns true for normal local command', () => {
    expect(shouldIndexBlock({ isRemote: false, command: 'git status' })).toBe(true);
  });

  it('returns true when isRemote is undefined (local default)', () => {
    expect(shouldIndexBlock({ command: 'npm test' })).toBe(true);
  });

  it('returns true for AI-suggested commands that the user ran locally (isSuggested is not filtered)', () => {
    // AI-suggested commands are valid local history; only isRemote matters
    expect(shouldIndexBlock({ isRemote: false, command: 'git push --force-with-lease' })).toBe(true);
  });
});
