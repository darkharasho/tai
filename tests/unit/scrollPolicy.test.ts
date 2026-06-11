import { describe, it, expect } from 'vitest';
import { isPinnedToBottom } from '@/utils/scrollPolicy';

describe('isPinnedToBottom', () => {
  it('is pinned when scrolled exactly to the bottom', () => {
    expect(isPinnedToBottom({ scrollTop: 900, clientHeight: 100, scrollHeight: 1000 })).toBe(true);
  });

  it('is pinned within the slop window of the bottom', () => {
    expect(isPinnedToBottom({ scrollTop: 860, clientHeight: 100, scrollHeight: 1000 })).toBe(true);
  });

  it('is not pinned when scrolled up past the slop window', () => {
    expect(isPinnedToBottom({ scrollTop: 500, clientHeight: 100, scrollHeight: 1000 })).toBe(false);
  });

  it('is pinned when content fits without scrolling', () => {
    expect(isPinnedToBottom({ scrollTop: 0, clientHeight: 500, scrollHeight: 400 })).toBe(true);
  });

  it('respects a custom slop', () => {
    expect(isPinnedToBottom({ scrollTop: 700, clientHeight: 100, scrollHeight: 1000 }, 250)).toBe(true);
    expect(isPinnedToBottom({ scrollTop: 700, clientHeight: 100, scrollHeight: 1000 }, 100)).toBe(false);
  });
});
