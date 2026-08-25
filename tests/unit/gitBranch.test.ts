import { describe, it, expect, vi } from 'vitest';
import { resolveGitBranch, parseGitStatus, resolveGitStatus } from '../../electron/services/git';

describe('resolveGitBranch', () => {
  it('returns the trimmed branch name from exec output', () => {
    const exec = (_cwd: string) => 'main\n';
    expect(resolveGitBranch('/repo', exec)).toBe('main');
  });

  it('returns null when not in a git repo (exec throws)', () => {
    const exec = () => { throw new Error('not a git repository'); };
    expect(resolveGitBranch('/tmp', exec)).toBeNull();
  });

  it('returns null for empty/detached output', () => {
    expect(resolveGitBranch('/repo', () => '')).toBeNull();
    expect(resolveGitBranch('/repo', () => 'HEAD\n')).toBeNull();
  });
});

describe('parseGitStatus', () => {
  const HEADERS = [
    '# branch.oid 4e2f7069a',
    '# branch.head master',
    '# branch.ab +2 -0',
  ].join('\n');

  it('reads the branch out of the v2 header', () => {
    expect(parseGitStatus(HEADERS).branch).toBe('master');
  });

  it('reports a clean tree as zero changes', () => {
    expect(parseGitStatus(HEADERS)).toEqual({ branch: 'master', dirty: 0 });
  });

  it('counts staged, unstaged and untracked entries alike', () => {
    const out = [
      HEADERS,
      '1 M. N... 100644 100644 100644 aaa bbb staged.ts',
      '1 .M N... 100644 100644 100644 ccc ddd unstaged.ts',
      '? untracked.ts',
    ].join('\n');
    expect(parseGitStatus(out)).toEqual({ branch: 'master', dirty: 3 });
  });

  it('counts renames and unmerged entries', () => {
    const out = [
      HEADERS,
      '2 R. N... 100644 100644 100644 aaa bbb R100 new.ts\told.ts',
      'u UU N... 100644 100644 100644 100644 aaa bbb ccc conflict.ts',
    ].join('\n');
    expect(parseGitStatus(out).dirty).toBe(2);
  });

  it('treats a detached HEAD as no branch', () => {
    const out = '# branch.oid 4e2f7069a\n# branch.head (detached)\n';
    expect(parseGitStatus(out).branch).toBeNull();
  });

  it('ignores trailing blank lines rather than counting them as changes', () => {
    expect(parseGitStatus(`${HEADERS}\n? untracked.ts\n\n`).dirty).toBe(1);
  });

  it('returns nothing useful for empty output', () => {
    expect(parseGitStatus('')).toEqual({ branch: null, dirty: 0 });
  });
});

describe('resolveGitStatus', () => {
  it('reports a clean null status when git fails', () => {
    const boom = () => { throw new Error('not a git repository'); };
    expect(resolveGitStatus('/tmp', boom)).toEqual({ branch: null, dirty: 0 });
  });

  it('passes the cwd through to the exec', () => {
    const exec = vi.fn().mockReturnValue('# branch.head main\n');
    expect(resolveGitStatus('/repo', exec).branch).toBe('main');
    expect(exec).toHaveBeenCalledWith('/repo');
  });
});
