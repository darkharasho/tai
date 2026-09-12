import { describe, it, expect } from 'vitest';
import {
  parsePpidFromStat, parseProcStatus, parsePsPpid, parsePsIdentity,
  isRootSudo, resolveSudoParent, type SudoParentDeps,
} from '../../electron/services/sudoParent';

const SUDO_STATUS = 'Name:\tsudo\nUmask:\t0022\nState:\tS (sleeping)\nUid:\t1000\t0\t0\t0\nGid:\t1000\t1000\t1000\t1000\n';

describe('parsers', () => {
  it('reads ppid from /proc stat, tolerating spaces and parens in comm', () => {
    expect(parsePpidFromStat('4242 (askpass) S 4100 4242 4000 0 -1')).toBe(4100);
    expect(parsePpidFromStat('4242 (weird (name) x) S 4100 4242')).toBe(4100);
  });

  it('rejects ppid 0/1 and garbage', () => {
    expect(parsePpidFromStat('4242 (a) S 1 4242')).toBeNull();
    expect(parsePpidFromStat('4242 (a) S 0 4242')).toBeNull();
    expect(parsePpidFromStat('garbage')).toBeNull();
    expect(parsePpidFromStat('')).toBeNull();
  });

  it('reads name and all uids from /proc status', () => {
    expect(parseProcStatus(SUDO_STATUS)).toEqual({ name: 'sudo', uids: [1000, 0, 0, 0] });
    expect(parseProcStatus('Name:\tsudo\n')).toBeNull();
    expect(parseProcStatus('')).toBeNull();
  });

  it('reads ps output', () => {
    expect(parsePsPpid('  4100\n')).toBe(4100);
    expect(parsePsPpid('\n')).toBeNull();
    expect(parsePsIdentity('sudo              501     0     0\n')).toEqual({ name: 'sudo', uids: [501, 0, 0] });
    expect(parsePsIdentity('sudo\n')).toBeNull();
  });

  it('isRootSudo requires name sudo and some uid 0', () => {
    expect(isRootSudo({ name: 'sudo', uids: [1000, 0, 0, 0] })).toBe(true);
    expect(isRootSudo({ name: 'sudo', uids: [1000, 1000, 1000, 1000] })).toBe(false);
    expect(isRootSudo({ name: 'bash', uids: [0, 0, 0, 0] })).toBe(false);
    expect(isRootSudo({ name: 'sudo', uids: [] })).toBe(false);
    expect(isRootSudo(null)).toBe(false);
  });
});

function linuxDeps(files: Record<string, string>): SudoParentDeps {
  return {
    platform: 'linux',
    readFile: (p) => { if (p in files) return files[p]; throw new Error('ENOENT'); },
    run: () => { throw new Error('ps must not be used on linux'); },
  };
}

describe('resolveSudoParent (linux)', () => {
  it('returns the sudo pid for a root-privileged sudo parent', () => {
    const deps = linuxDeps({ '/proc/4242/stat': '4242 (node) S 4100 1 1', '/proc/4100/status': SUDO_STATUS });
    expect(resolveSudoParent(4242, deps)).toBe(4100);
  });

  it('refuses a user-owned process named sudo', () => {
    const deps = linuxDeps({
      '/proc/4242/stat': '4242 (node) S 4100 1 1',
      '/proc/4100/status': 'Name:\tsudo\nUid:\t1000\t1000\t1000\t1000\n',
    });
    expect(resolveSudoParent(4242, deps)).toBeNull();
  });

  it('refuses a root parent that is not sudo', () => {
    const deps = linuxDeps({
      '/proc/4242/stat': '4242 (node) S 4100 1 1',
      '/proc/4100/status': 'Name:\tsystemd\nUid:\t0\t0\t0\t0\n',
    });
    expect(resolveSudoParent(4242, deps)).toBeNull();
  });

  it('refuses when anything is unreadable or the pid is invalid', () => {
    expect(resolveSudoParent(4242, linuxDeps({}))).toBeNull();
    expect(resolveSudoParent(4242, linuxDeps({ '/proc/4242/stat': '4242 (node) S 4100 1 1' }))).toBeNull();
    expect(resolveSudoParent(0, linuxDeps({}))).toBeNull();
    expect(resolveSudoParent(1, linuxDeps({}))).toBeNull();
    expect(resolveSudoParent(Number.NaN, linuxDeps({}))).toBeNull();
  });
});

describe('resolveSudoParent (darwin)', () => {
  function macDeps(outputs: Record<string, string>): SudoParentDeps {
    return {
      platform: 'darwin',
      readFile: () => { throw new Error('no /proc on darwin'); },
      run: (cmd, args) => {
        const k = `${cmd} ${args.join(' ')}`;
        if (k in outputs) return outputs[k];
        throw new Error(`unexpected ${k}`);
      },
    };
  }

  it('returns the sudo pid via ps', () => {
    const deps = macDeps({
      '/bin/ps -o ppid= -p 4242': ' 4100\n',
      '/bin/ps -o ucomm=,ruid=,uid=,svuid= -p 4100': 'sudo  501  0  0\n',
    });
    expect(resolveSudoParent(4242, deps)).toBe(4100);
  });

  it('refuses when ps fails or identity is not root sudo', () => {
    expect(resolveSudoParent(4242, macDeps({}))).toBeNull();
    const deps = macDeps({
      '/bin/ps -o ppid= -p 4242': ' 4100\n',
      '/bin/ps -o ucomm=,ruid=,uid=,svuid= -p 4100': 'sudo  501  501  501\n',
    });
    expect(resolveSudoParent(4242, deps)).toBeNull();
  });
});

describe('resolveSudoParent (win32)', () => {
  it('always refuses', () => {
    expect(resolveSudoParent(4242, { platform: 'win32', readFile: () => '', run: () => '' })).toBeNull();
  });
});
