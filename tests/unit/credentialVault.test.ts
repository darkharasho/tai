import { describe, it, expect } from 'vitest';
import { CredentialVault } from '../../electron/services/credentialVault';

describe('CredentialVault', () => {
  it('starts empty', () => {
    const v = new CredentialVault();
    expect(v.isSet()).toBe(false);
    expect(v.get()).toBeNull();
  });

  it('stores and returns the secret', () => {
    const v = new CredentialVault();
    v.set(Buffer.from('hunter2', 'utf8'));
    expect(v.isSet()).toBe(true);
    expect(v.get()?.toString('utf8')).toBe('hunter2');
  });

  it('replacing a secret zero-fills the previous buffer', () => {
    const v = new CredentialVault();
    const first = Buffer.from('old', 'utf8');
    v.set(first);
    v.set(Buffer.from('new', 'utf8'));
    expect(first.every((b) => b === 0)).toBe(true);
    expect(v.get()?.toString('utf8')).toBe('new');
  });

  it('clear() zero-fills and empties', () => {
    const v = new CredentialVault();
    const buf = Buffer.from('secret', 'utf8');
    v.set(buf);
    v.clear();
    expect(v.isSet()).toBe(false);
    expect(v.get()).toBeNull();
    expect(buf.every((b) => b === 0)).toBe(true);
  });
});
