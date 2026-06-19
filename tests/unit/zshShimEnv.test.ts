// tests/unit/zshShimEnv.test.ts
import { describe, it, expect } from 'vitest';
import { buildZshShimEnv } from '../../electron/services/pty';

const opts = { shimDir: '/app/zsh-shim', integrationPath: '/app/tai-zsh.zsh', home: '/home/u' };

describe('buildZshShimEnv', () => {
  it('points ZDOTDIR at the shim and records the integration path', () => {
    const e = buildZshShimEnv({}, opts);
    expect(e.ZDOTDIR).toBe('/app/zsh-shim');
    expect(e.TAI_ZSH_SHIM).toBe('/app/zsh-shim');
    expect(e.TAI_ZSH_INTEGRATION).toBe('/app/tai-zsh.zsh');
  });
  it('defaults TAI_ZDOTDIR_USER to HOME and marks not-set when ZDOTDIR is absent', () => {
    const e = buildZshShimEnv({}, opts);
    expect(e.TAI_ZDOTDIR_USER).toBe('/home/u');
    expect(e.TAI_ZDOTDIR_WAS_SET).toBe('');
  });
  it('preserves a user-set ZDOTDIR and marks it set', () => {
    const e = buildZshShimEnv({ ZDOTDIR: '/home/u/.zsh' }, opts);
    expect(e.TAI_ZDOTDIR_USER).toBe('/home/u/.zsh');
    expect(e.TAI_ZDOTDIR_WAS_SET).toBe('1');
  });
  it('does not mutate the input env', () => {
    const base: Record<string,string> = {};
    buildZshShimEnv(base, opts);
    expect(base.ZDOTDIR).toBeUndefined();
  });
});
