import { describe, it, expect } from 'vitest';
import { delimiter } from 'node:path';
import { scanPathBinaries, MAX_BINARIES } from '../../electron/services/pathBinaries';

const P = (...dirs: string[]) => dirs.join(delimiter);

describe('scanPathBinaries', () => {
  it('collects basenames from every directory on PATH', () => {
    const read = (dir: string) => (dir === '/usr/bin' ? ['ls', 'git'] : ['kubectl']);
    expect(scanPathBinaries(P('/usr/bin', '/usr/local/bin'), read).sort())
      .toEqual(['git', 'kubectl', 'ls']);
  });

  it('de-duplicates a binary that shadows another on a later directory', () => {
    const read = () => ['python3'];
    expect(scanPathBinaries(P('/a', '/b'), read)).toEqual(['python3']);
  });

  // A missing or permission-denied directory on PATH is completely ordinary.
  it('skips unreadable directories instead of throwing', () => {
    const read = (dir: string) => {
      if (dir === '/nope') throw new Error('ENOENT');
      return ['ls'];
    };
    expect(scanPathBinaries(P('/nope', '/usr/bin'), read)).toEqual(['ls']);
  });

  it('tolerates an empty PATH and empty segments', () => {
    expect(scanPathBinaries('', () => ['ls'])).toEqual([]);
    expect(scanPathBinaries(P('', '/usr/bin'), () => ['ls'])).toEqual(['ls']);
  });

  it('caps the result so a pathological PATH cannot blow up the IPC payload', () => {
    const read = () => Array.from({ length: MAX_BINARIES + 500 }, (_, i) => `bin${i}`);
    expect(scanPathBinaries('/usr/bin', read).length).toBe(MAX_BINARIES);
  });
});
