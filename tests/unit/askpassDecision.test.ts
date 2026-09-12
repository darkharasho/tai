import { describe, it, expect } from 'vitest';
import { decideAskpass } from '../../electron/services/askpassDecision';

describe('decideAskpass', () => {
  it('refuses when the parent is not verified sudo, even with a cached secret', () => {
    expect(decideAskpass({ sudoPid: null, vaultSet: true, lastFilledSudoPid: null })).toBe('refuse');
    expect(decideAskpass({ sudoPid: null, vaultSet: false, lastFilledSudoPid: null })).toBe('refuse');
  });

  it('auto-fills a verified sudo when cached and not yet filled', () => {
    expect(decideAskpass({ sudoPid: 500, vaultSet: true, lastFilledSudoPid: null })).toBe('auto-fill');
  });

  it('auto-fills a DIFFERENT sudo process right after a prior fill', () => {
    expect(decideAskpass({ sudoPid: 501, vaultSet: true, lastFilledSudoPid: 500 })).toBe('auto-fill');
  });

  it('rejects when the SAME sudo process asks again (cached secret was wrong)', () => {
    expect(decideAskpass({ sudoPid: 500, vaultSet: true, lastFilledSudoPid: 500 })).toBe('reject');
  });

  it('prompts when nothing is cached', () => {
    expect(decideAskpass({ sudoPid: 500, vaultSet: false, lastFilledSudoPid: null })).toBe('prompt');
    expect(decideAskpass({ sudoPid: 500, vaultSet: false, lastFilledSudoPid: 500 })).toBe('prompt');
  });
});
