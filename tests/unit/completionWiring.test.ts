// tests/unit/completionWiring.test.ts
import { describe, it, expect } from 'vitest';
import { getSpecCompletions } from '@/components/TerminalInput';

describe('getSpecCompletions', () => {
  it('returns spec items for a known command', () => {
    const items = getSpecCompletions('git ch');
    expect(items?.map(i => i.value)).toContain('checkout');
  });
  it('returns null for an unknown command (→ compgen fallback)', () => {
    expect(getSpecCompletions('frobnicate --')).toBeNull();
  });
  it('returns null when the spec yields no items at a path position (→ compgen)', () => {
    expect(getSpecCompletions('git commit -m ')).toBeNull();
  });
});
