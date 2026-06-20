import { describe, it, expect } from 'vitest';
import { resolveForeground } from '../../electron/services/foregroundProcess';

// stat layout: "<pid> (<comm>) <state> <ppid> <pgrp> <session> <tty_nr> <tpgid> ..."
// After slicing past ") ", tpgid is field index 5.
function statWithTpgid(tpgid: number): string {
  return `100 (bash) S 99 100 100 34816 ${tpgid} 4194304 ...rest...`;
}

describe('resolveForeground', () => {
  it('returns "sudo" when the foreground comm is sudo', () => {
    const fakeRead = (p: string) => {
      if (p === '/proc/100/stat') return statWithTpgid(200);
      if (p === '/proc/200/comm') return 'sudo\n';
      throw new Error('unexpected path ' + p);
    };
    expect(resolveForeground(100, fakeRead)).toBe('sudo');
  });

  it('returns "other" when the foreground comm is not sudo', () => {
    const fakeRead = (p: string) => {
      if (p === '/proc/100/stat') return statWithTpgid(200);
      if (p === '/proc/200/comm') return 'ssh\n';
      throw new Error('unexpected path ' + p);
    };
    expect(resolveForeground(100, fakeRead)).toBe('other');
  });

  it('handles a comm containing spaces/parens via lastIndexOf(")")', () => {
    const fakeRead = (p: string) => {
      if (p === '/proc/100/stat') return `100 (weird ) name) S 99 100 100 34816 200 0 ...`;
      if (p === '/proc/200/comm') return 'sudo\n';
      throw new Error('unexpected path ' + p);
    };
    expect(resolveForeground(100, fakeRead)).toBe('sudo');
  });

  it('returns "unknown" when tpgid is invalid', () => {
    const fakeRead = (p: string) => {
      if (p === '/proc/100/stat') return statWithTpgid(-1);
      throw new Error('unexpected path ' + p);
    };
    expect(resolveForeground(100, fakeRead)).toBe('unknown');
  });

  it('returns "unknown" when a read throws', () => {
    const fakeRead = (_p: string): string => { throw new Error('ENOENT'); };
    expect(resolveForeground(100, fakeRead)).toBe('unknown');
  });
});
