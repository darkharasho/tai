// tests/unit/completionRegistry.test.ts
import { describe, it, expect } from 'vitest';
import { getSpec } from '@/completions/registry';
import { resolveCompletion, tokenize } from '@/completions/resolveCompletion';

describe('completion registry', () => {
  it('returns a spec for git and resolves a real subcommand', () => {
    const spec = getSpec('git');
    expect(spec).toBeTruthy();
    const { tokens, lastToken } = tokenize('git ch');
    const items = resolveCompletion(spec!, tokens, lastToken).items.map(i => i.value);
    expect(items).toContain('checkout');
  });
  it('returns a spec for docker and npm', () => {
    expect(getSpec('docker')).toBeTruthy();
    expect(getSpec('npm')).toBeTruthy();
  });
  it('returns null for an unknown command', () => {
    expect(getSpec('frobnicate')).toBeNull();
  });
});
