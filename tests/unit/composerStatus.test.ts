import { describe, it, expect } from 'vitest';
import { describeProvenance, formatBranchChip, describeBranch } from '../../src/utils/composerStatus';
import { createIndex, ingestBlock, type CommandIndex } from '../../src/utils/commandIndex';

function indexWith(entries: Array<{ command: string; cwd?: string }>): CommandIndex {
  const idx = createIndex();
  for (const e of entries) ingestBlock(idx, { ...e, ts: 1000 });
  return idx;
}

describe('describeProvenance', () => {
  it('returns null when there is no prediction to attribute', () => {
    expect(describeProvenance(null, 'history', createIndex(), '/repo')).toBeNull();
    expect(describeProvenance('npm test', null, createIndex(), '/repo')).toBeNull();
  });

  it('attributes AI suggestions without consulting the index', () => {
    expect(describeProvenance('npm test', 'ai', createIndex(), '/repo')).toBe('from AI');
  });

  it('prefers the count for the current directory', () => {
    const idx = indexWith([
      { command: 'npm test', cwd: '/repo' },
      { command: 'npm test', cwd: '/repo' },
      { command: 'npm test', cwd: '/elsewhere' },
    ]);
    expect(describeProvenance('npm test', 'history', idx, '/repo')).toBe('from history · 2× here');
  });

  it('falls back to the global count when the command is new to this directory', () => {
    const idx = indexWith([
      { command: 'npm test', cwd: '/elsewhere' },
      { command: 'npm test', cwd: '/elsewhere' },
    ]);
    expect(describeProvenance('npm test', 'history', idx, '/repo')).toBe('from history · 2×');
  });

  it('labels next-command predictions differently from prefix matches', () => {
    const idx = indexWith([{ command: 'npm test', cwd: '/repo' }]);
    expect(describeProvenance('npm test', 'next', idx, '/repo')).toBe('likely next · 1× here');
  });

  it('still labels a next-command prediction the index has never seen', () => {
    expect(describeProvenance('npm test', 'next', createIndex(), '/repo')).toBe('likely next');
  });

  it('stays silent for a prefix match the index cannot vouch for', () => {
    expect(describeProvenance('npm test', 'history', createIndex(), '/repo')).toBeNull();
  });

  it('matches the index on the trimmed command', () => {
    const idx = indexWith([{ command: 'npm test', cwd: '/repo' }]);
    expect(describeProvenance('  npm test  ', 'history', idx, '/repo')).toBe('from history · 1× here');
  });

  it('uses the global count when no cwd is known', () => {
    const idx = indexWith([{ command: 'npm test', cwd: '/repo' }]);
    expect(describeProvenance('npm test', 'history', idx, '')).toBe('from history · 1×');
  });
});

describe('formatBranchChip', () => {
  it('renders nothing outside a repository', () => {
    expect(formatBranchChip(null, 0)).toBeNull();
    expect(formatBranchChip(null, 3)).toBeNull();
  });

  it('shows the bare branch when the tree is clean', () => {
    expect(formatBranchChip('master', 0)).toBe('master');
  });

  it('appends the change count when the tree is dirty', () => {
    expect(formatBranchChip('master', 2)).toBe('master +2');
  });

  it('ignores a negative count rather than rendering "+-1"', () => {
    expect(formatBranchChip('master', -1)).toBe('master');
  });
});

describe('describeBranch', () => {
  it('has no title outside a repository', () => {
    expect(describeBranch(null, 0)).toBeUndefined();
  });

  it('says the tree is clean', () => {
    expect(describeBranch('master', 0)).toBe('On master — working tree clean');
  });

  it('singularizes a lone change', () => {
    expect(describeBranch('master', 1)).toBe('On master — 1 uncommitted change');
  });

  it('pluralizes multiple changes', () => {
    expect(describeBranch('master', 4)).toBe('On master — 4 uncommitted changes');
  });
});
