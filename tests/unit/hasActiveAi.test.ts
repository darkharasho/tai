import { describe, it, expect } from 'vitest';
import { hasActiveAi } from '@/utils/hasActiveAi';

describe('hasActiveAi', () => {
  it('returns false for an empty list', () => {
    expect(hasActiveAi([])).toBe(false);
  });

  it('returns true when an ai item is streaming', () => {
    const items: any[] = [
      { type: 'ai', id: 'a', question: '', entries: [], content: '', streaming: true },
    ];
    expect(hasActiveAi(items)).toBe(true);
  });

  it('returns false when ai items exist but none are streaming', () => {
    const items: any[] = [
      { type: 'ai', id: 'a', question: '', entries: [], content: '', streaming: false },
      { type: 'ai', id: 'b', question: '', entries: [], content: '', streaming: false },
    ];
    expect(hasActiveAi(items)).toBe(false);
  });

  it('ignores non-ai items', () => {
    const items: any[] = [
      { type: 'command', block: { id: 'x' }, collapsed: false, active: true, aiSuggested: false },
      { type: 'approval', id: 'y', command: '', status: 'pending' },
    ];
    expect(hasActiveAi(items)).toBe(false);
  });

  it('returns true if any ai item among many is streaming', () => {
    const items: any[] = [
      { type: 'ai', id: 'a', question: '', entries: [], content: '', streaming: false },
      { type: 'ai', id: 'b', question: '', entries: [], content: '', streaming: true },
    ];
    expect(hasActiveAi(items)).toBe(true);
  });
});
