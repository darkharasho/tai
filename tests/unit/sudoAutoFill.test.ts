import { describe, it, expect } from 'vitest';
import { decideAutoFill, REJECT_WINDOW_MS } from '../../electron/services/sudoAutoFill';

describe('decideAutoFill', () => {
  it('auto-fills when sudo + cached + no recent auto-fill', () => {
    expect(decideAutoFill({ foreground: 'sudo', vaultSet: true, msSinceLastAutoFill: null }))
      .toBe('auto-fill');
  });

  it('auto-fills when the last auto-fill is older than the reject window', () => {
    expect(decideAutoFill({ foreground: 'sudo', vaultSet: true, msSinceLastAutoFill: REJECT_WINDOW_MS + 1 }))
      .toBe('auto-fill');
  });

  it('rejects (cached secret was wrong) when sudo re-prompts within the window', () => {
    expect(decideAutoFill({ foreground: 'sudo', vaultSet: true, msSinceLastAutoFill: 500 }))
      .toBe('reject');
  });

  it('prompts when nothing is cached', () => {
    expect(decideAutoFill({ foreground: 'sudo', vaultSet: false, msSinceLastAutoFill: null }))
      .toBe('prompt');
  });

  it('prompts (never auto-fills) for non-sudo foreground even if cached', () => {
    expect(decideAutoFill({ foreground: 'other', vaultSet: true, msSinceLastAutoFill: null }))
      .toBe('prompt');
  });

  it('prompts for unknown foreground (fail safe)', () => {
    expect(decideAutoFill({ foreground: 'unknown', vaultSet: true, msSinceLastAutoFill: null }))
      .toBe('prompt');
  });
});
