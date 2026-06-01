import { describe, it, expect } from 'vitest';
import { parseOsc6973, encodeOsc6973 } from '@/utils/osc6973';
import type { PreexecHook, PrecmdHook } from '@/types/shellHooks';

describe('parseOsc6973', () => {
  it('decodes a preexec payload', () => {
    const payload: PreexecHook = { hook: 'preexec', command: 'ls -la' };
    const hex = Buffer.from(JSON.stringify(payload)).toString('hex');
    expect(parseOsc6973(hex)).toEqual(payload);
  });

  it('decodes a precmd payload with all fields', () => {
    const payload: PrecmdHook = {
      hook: 'precmd',
      exit: 0,
      signal: null,
      duration_ms: 142,
      command: 'git status',
      cwd: '/home/m/code/tai',
    };
    const hex = Buffer.from(JSON.stringify(payload)).toString('hex');
    expect(parseOsc6973(hex)).toEqual(payload);
  });

  it('returns null for malformed hex', () => {
    expect(parseOsc6973('zzz')).toBeNull();
  });

  it('returns null for non-JSON', () => {
    const hex = Buffer.from('not json').toString('hex');
    expect(parseOsc6973(hex)).toBeNull();
  });

  it('returns null for unknown hook names', () => {
    const hex = Buffer.from(JSON.stringify({ hook: 'wat' })).toString('hex');
    expect(parseOsc6973(hex)).toBeNull();
  });

  it('returns null for preexec missing command field', () => {
    const hex = Buffer.from(JSON.stringify({ hook: 'preexec' })).toString('hex');
    expect(parseOsc6973(hex)).toBeNull();
  });

  it('returns null for precmd missing required fields', () => {
    const hex = Buffer.from(JSON.stringify({ hook: 'precmd', exit: 0 })).toString('hex');
    expect(parseOsc6973(hex)).toBeNull();
  });
});

describe('encodeOsc6973', () => {
  it('round-trips through parseOsc6973', () => {
    const payload: PreexecHook = { hook: 'preexec', command: 'echo hi' };
    const encoded = encodeOsc6973(payload);
    expect(encoded).toMatch(/^\x1b\]6973;[0-9a-f]+\x07$/);
    const hex = encoded.slice('\x1b]6973;'.length, -1);
    expect(parseOsc6973(hex)).toEqual(payload);
  });
});
