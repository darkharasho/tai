import { describe, it, expect } from 'vitest';
import { resolveEffectiveRemote } from '../../src/utils/remoteOverride';

describe('resolveEffectiveRemote', () => {
  it('uses autodetection when there is no manual override', () => {
    expect(resolveEffectiveRemote(true, 'user@host', null)).toEqual({
      isRemote: true,
      sshTarget: 'user@host',
      source: 'auto',
    });
    expect(resolveEffectiveRemote(false, null, null)).toEqual({
      isRemote: false,
      sshTarget: null,
      source: 'auto',
    });
  });

  it('lets a manual override force remote even when autodetection says local', () => {
    expect(resolveEffectiveRemote(false, null, 'box')).toEqual({
      isRemote: true,
      sshTarget: 'box',
      source: 'manual',
    });
  });

  it('lets a manual override take precedence over a different autodetected target', () => {
    expect(resolveEffectiveRemote(true, 'auto@host', 'manual@host')).toEqual({
      isRemote: true,
      sshTarget: 'manual@host',
      source: 'manual',
    });
  });

  it('treats an empty/whitespace manual override as no override', () => {
    expect(resolveEffectiveRemote(true, 'user@host', '   ').source).toBe('auto');
    expect(resolveEffectiveRemote(false, null, '').source).toBe('auto');
  });
});
