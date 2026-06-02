import { describe, it, expect } from 'vitest';
import { resolveGitBranch } from '../../electron/services/git';

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
