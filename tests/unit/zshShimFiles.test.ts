// tests/unit/zshShimFiles.test.ts
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const dir = path.resolve(__dirname, '../../electron/shell-integration/zsh-shim');
const read = (f: string) => fs.readFileSync(path.join(dir, f), 'utf8');

describe('zsh shim files', () => {
  it('ships all four startup files', () => {
    for (const f of ['.zshenv', '.zprofile', '.zshrc', '.zlogin']) {
      expect(fs.existsSync(path.join(dir, f)), f).toBe(true);
    }
  });
  it('.zshrc sources the user .zshrc, then the integration, then restores ZDOTDIR', () => {
    const z = read('.zshrc');
    expect(z).toMatch(/TAI_ZDOTDIR_USER.*\.zshrc/s);            // sources user's
    expect(z).toContain('$TAI_ZSH_INTEGRATION');                // loads integration
    expect(z).toMatch(/unset ZDOTDIR|ZDOTDIR=.*TAI_ZDOTDIR_USER/); // restores
  });
  it('.zshenv and .zprofile source the user file and re-assert the shim dir', () => {
    for (const f of ['.zshenv', '.zprofile']) {
      const z = read(f);
      expect(z, f).toMatch(/TAI_ZDOTDIR_USER/);
      expect(z, f).toMatch(/ZDOTDIR="?\$\{?TAI_ZSH_SHIM/);  // re-assert shim
    }
  });
  it('every shim file guards user-file existence with [ -f ]', () => {
    for (const f of ['.zshenv', '.zprofile', '.zshrc', '.zlogin']) {
      expect(read(f), f).toMatch(/\[ -f /);
    }
  });
});
