import { describe, it, expect } from 'vitest';
import {
  unpackedAsarPath,
  binaryCandidates,
  isMuslLinux,
  resolveClaudeExecutable,
} from '../../electron/services/claudeExecutable';

const PKG = '@anthropic-ai/claude-agent-sdk';

describe('unpackedAsarPath', () => {
  it('redirects a path inside app.asar to app.asar.unpacked', () => {
    expect(unpackedAsarPath(`/opt/tai/resources/app.asar/node_modules/${PKG}-linux-x64/claude`))
      .toBe(`/opt/tai/resources/app.asar.unpacked/node_modules/${PKG}-linux-x64/claude`);
  });

  it('handles Windows separators', () => {
    expect(unpackedAsarPath('C:\\app\\resources\\app.asar\\node_modules\\x\\claude.exe'))
      .toBe('C:\\app\\resources\\app.asar.unpacked\\node_modules\\x\\claude.exe');
  });

  it('leaves unpackaged paths alone', () => {
    const p = `/home/me/tai/node_modules/${PKG}-linux-x64/claude`;
    expect(unpackedAsarPath(p)).toBe(p);
  });

  it('does not rewrite a trailing app.asar with no path after it', () => {
    expect(unpackedAsarPath('/opt/tai/resources/app.asar')).toBe('/opt/tai/resources/app.asar');
  });
});

describe('binaryCandidates', () => {
  it('uses claude.exe on Windows', () => {
    expect(binaryCandidates('win32', 'x64', false)).toEqual([`${PKG}-win32-x64/claude.exe`]);
  });

  it('prefers glibc then musl on ordinary Linux', () => {
    expect(binaryCandidates('linux', 'x64', false))
      .toEqual([`${PKG}-linux-x64/claude`, `${PKG}-linux-x64-musl/claude`]);
  });

  it('prefers musl first when detected', () => {
    expect(binaryCandidates('linux', 'arm64', true))
      .toEqual([`${PKG}-linux-arm64-musl/claude`, `${PKG}-linux-arm64/claude`]);
  });

  it('uses a single platform dir on darwin', () => {
    expect(binaryCandidates('darwin', 'arm64', false)).toEqual([`${PKG}-darwin-arm64/claude`]);
  });
});

describe('isMuslLinux', () => {
  const report = (glibc?: string) =>
    ({ getReport: () => ({ header: { glibcVersionRuntime: glibc } }) }) as any;

  it('is false off Linux', () => {
    expect(isMuslLinux('darwin', report(undefined))).toBe(false);
  });

  it('is false when glibc is reported', () => {
    expect(isMuslLinux('linux', report('2.39'))).toBe(false);
  });

  it('is true when no glibc runtime is reported', () => {
    expect(isMuslLinux('linux', report(undefined))).toBe(true);
  });

  it('is false when the report API is unavailable', () => {
    expect(isMuslLinux('linux', undefined as any)).toBe(false);
  });
});

describe('resolveClaudeExecutable', () => {
  const ASAR = '/opt/tai/resources/app.asar';
  const asarBin = `${ASAR}/node_modules/${PKG}-linux-x64/claude`;
  const unpackedBin = `/opt/tai/resources/app.asar.unpacked/node_modules/${PKG}-linux-x64/claude`;

  const base = { platform: 'linux' as const, arch: 'x64', muslFirst: false };

  it('returns the unpacked binary, never the unspawnable asar path', () => {
    // Electron's fs shim makes BOTH paths "exist" — the asar one cannot be
    // exec'd (ENOTDIR), which is the bug this guards.
    const got = resolveClaudeExecutable({
      ...base,
      appPath: ASAR,
      exists: (p) => p === asarBin || p === unpackedBin,
    });
    expect(got).toBe(unpackedBin);
  });

  it('un-asars a path coming from require.resolve too', () => {
    const got = resolveClaudeExecutable({
      ...base,
      appPath: null,
      resolve: (spec) => `${ASAR}/node_modules/${spec}`,
      exists: (p) => p === unpackedBin,
    });
    expect(got).toBe(unpackedBin);
  });

  it('returns a plain node_modules path unchanged in development', () => {
    const dev = `/home/me/tai/node_modules/${PKG}-linux-x64/claude`;
    const got = resolveClaudeExecutable({
      ...base,
      appPath: '/home/me/tai',
      exists: (p) => p === dev,
    });
    expect(got).toBe(dev);
  });

  it('falls back to the musl flavour when the glibc one is absent', () => {
    const musl = `/home/me/tai/node_modules/${PKG}-linux-x64-musl/claude`;
    const got = resolveClaudeExecutable({
      ...base,
      appPath: '/home/me/tai',
      exists: (p) => p === musl,
    });
    expect(got).toBe(musl);
  });

  it('returns null when nothing exists, so the SDK can fall back', () => {
    const got = resolveClaudeExecutable({ ...base, appPath: ASAR, exists: () => false });
    expect(got).toBeNull();
  });

  it('survives require.resolve throwing for an uninstalled platform package', () => {
    const got = resolveClaudeExecutable({
      ...base,
      appPath: null,
      resolve: () => { throw new Error('MODULE_NOT_FOUND'); },
      exists: () => true,
    });
    expect(got).toBeNull();
  });

  it('prefers the app path over require.resolve', () => {
    const got = resolveClaudeExecutable({
      ...base,
      appPath: '/home/me/tai',
      resolve: () => '/elsewhere/claude',
      exists: () => true,
    });
    expect(got).toBe(`/home/me/tai/node_modules/${PKG}-linux-x64/claude`);
  });
});
