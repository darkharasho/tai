import { describe, it, expect } from 'vitest';
import { decideAutoFill } from '../../electron/services/sudoAutoFill';

describe('decideAutoFill', () => {
  it('auto-fills when sudo + cached + nothing filled yet', () => {
    expect(decideAutoFill({ foreground: 'sudo', vaultSet: true, tpgid: 200, lastFilledTpgid: null }))
      .toBe('auto-fill');
  });

  it('auto-fills a NEW sudo invocation (different tpgid) even right after a prior fill', () => {
    // This is the chained-sudo case (`sudo a; sudo b`): the second prompt is a
    // different sudo process, so it must auto-fill — not be mistaken for a reject.
    expect(decideAutoFill({ foreground: 'sudo', vaultSet: true, tpgid: 201, lastFilledTpgid: 200 }))
      .toBe('auto-fill');
  });

  it('rejects when the SAME sudo process re-prompts (our cached secret was wrong)', () => {
    expect(decideAutoFill({ foreground: 'sudo', vaultSet: true, tpgid: 200, lastFilledTpgid: 200 }))
      .toBe('reject');
  });

  it('prompts when nothing is cached', () => {
    expect(decideAutoFill({ foreground: 'sudo', vaultSet: false, tpgid: 200, lastFilledTpgid: null }))
      .toBe('prompt');
  });

  it('prompts (never auto-fills) for non-sudo foreground even if cached', () => {
    expect(decideAutoFill({ foreground: 'other', vaultSet: true, tpgid: 200, lastFilledTpgid: null }))
      .toBe('prompt');
  });

  it('prompts for unknown foreground (fail safe)', () => {
    expect(decideAutoFill({ foreground: 'unknown', vaultSet: true, tpgid: null, lastFilledTpgid: null }))
      .toBe('prompt');
  });

  it('auto-fills when sudo+cached but tpgid is unresolved (can never equal lastFilled)', () => {
    expect(decideAutoFill({ foreground: 'sudo', vaultSet: true, tpgid: null, lastFilledTpgid: 200 }))
      .toBe('auto-fill');
  });
});
