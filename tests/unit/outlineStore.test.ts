import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  publishOutline, clearOutline, getOutline, getOutlineVersion,
  subscribeOutlines, resetOutlines,
} from '@/stores/outlineStore';
import { EMPTY_OUTLINE } from '@/utils/sessionOutline';

const pub = (currentId: string | null = null) => ({
  outline: EMPTY_OUTLINE,
  currentId,
  navigate: () => {},
});

describe('outlineStore', () => {
  beforeEach(() => resetOutlines());

  it('reads back what a tab published', () => {
    publishOutline('tab-1', pub('block-a'));
    expect(getOutline('tab-1')?.currentId).toBe('block-a');
    expect(getOutline('tab-2')).toBeUndefined();
  });

  it('bumps the version on publish so subscribers re-read', () => {
    const before = getOutlineVersion();
    publishOutline('tab-1', pub());
    expect(getOutlineVersion()).toBeGreaterThan(before);
  });

  it('notifies subscribers until they unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeOutlines(listener);
    publishOutline('tab-1', pub());
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    publishOutline('tab-1', pub());
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('drops a closed tab and notifies', () => {
    const listener = vi.fn();
    publishOutline('tab-1', pub());
    subscribeOutlines(listener);
    clearOutline('tab-1');
    expect(getOutline('tab-1')).toBeUndefined();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('stays quiet when clearing a tab that was never published', () => {
    const listener = vi.fn();
    subscribeOutlines(listener);
    clearOutline('ghost');
    expect(listener).not.toHaveBeenCalled();
  });
});
