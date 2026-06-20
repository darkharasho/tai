import { describe, it, expect } from 'vitest';
import { resolveForeground, resolveForegroundDetail } from '../../electron/services/foregroundProcess';

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

describe('resolveForegroundDetail', () => {
  it('returns kind + tpgid for a sudo foreground', () => {
    const fakeRead = (p: string) => {
      if (p === '/proc/100/stat') return statWithTpgid(200);
      if (p === '/proc/200/comm') return 'sudo\n';
      throw new Error('unexpected path ' + p);
    };
    expect(resolveForegroundDetail(100, fakeRead)).toEqual({ kind: 'sudo', tpgid: 200 });
  });

  it('returns kind=other with the tpgid for a non-sudo foreground', () => {
    const fakeRead = (p: string) => {
      if (p === '/proc/100/stat') return statWithTpgid(321);
      if (p === '/proc/321/comm') return 'ssh\n';
      throw new Error('unexpected path ' + p);
    };
    expect(resolveForegroundDetail(100, fakeRead)).toEqual({ kind: 'other', tpgid: 321 });
  });

  it('returns kind=unknown, tpgid=null when tpgid is invalid', () => {
    const fakeRead = (p: string) => {
      if (p === '/proc/100/stat') return statWithTpgid(-1);
      throw new Error('unexpected path ' + p);
    };
    expect(resolveForegroundDetail(100, fakeRead)).toEqual({ kind: 'unknown', tpgid: null });
  });

  it('returns kind=unknown, tpgid=null when a read throws', () => {
    const fakeRead = (_p: string): string => { throw new Error('ENOENT'); };
    expect(resolveForegroundDetail(100, fakeRead)).toEqual({ kind: 'unknown', tpgid: null });
  });
});
