import { describe, it, expect } from 'vitest';
import { capDisplayItems, MAX_SESSION_BLOCKS } from '@/utils/blockCap';

describe('capDisplayItems', () => {
  it('returns the same reference when under budget', () => {
    const items = [1, 2, 3];
    expect(capDisplayItems(items, 10)).toBe(items);
  });

  it('keeps only the last `max` items when over budget', () => {
    const items = Array.from({ length: 12 }, (_, i) => i);
    const capped = capDisplayItems(items, 10);
    expect(capped).toHaveLength(10);
    expect(capped[0]).toBe(2);
    expect(capped[9]).toBe(11);
  });

  it('defaults to MAX_SESSION_BLOCKS', () => {
    const items = Array.from({ length: MAX_SESSION_BLOCKS + 5 }, (_, i) => i);
    expect(capDisplayItems(items)).toHaveLength(MAX_SESSION_BLOCKS);
  });
});
