import { describe, it, expect } from 'vitest';
import { stripForceShellPrefix, shouldShowAutoBadge } from '@/utils/inputModeUx';

describe('stripForceShellPrefix', () => {
  it('strips a leading ! and forces shell in ai mode', () => {
    expect(stripForceShellPrefix('ai', '!ls -la')).toEqual({ value: 'ls -la', forceShell: true });
  });

  it('handles a lone ! in ai mode', () => {
    expect(stripForceShellPrefix('ai', '!')).toEqual({ value: '', forceShell: true });
  });

  it('leaves non-! ai input untouched', () => {
    expect(stripForceShellPrefix('ai', 'hello')).toEqual({ value: 'hello', forceShell: false });
  });

  it('never intercepts ! in shell mode (history expansion)', () => {
    expect(stripForceShellPrefix('shell', '!foo')).toEqual({ value: '!foo', forceShell: false });
  });

  it('only strips a leading !, not a mid-string one', () => {
    expect(stripForceShellPrefix('ai', 'foo!bar')).toEqual({ value: 'foo!bar', forceShell: false });
  });
});

describe('shouldShowAutoBadge', () => {
  it('shows when autodetect governs non-empty input', () => {
    expect(shouldShowAutoBadge('git status', false)).toBe(true);
  });

  it('hides when manually overridden', () => {
    expect(shouldShowAutoBadge('git status', true)).toBe(false);
  });

  it('hides on empty or whitespace-only input', () => {
    expect(shouldShowAutoBadge('', false)).toBe(false);
    expect(shouldShowAutoBadge('   ', false)).toBe(false);
  });
});
