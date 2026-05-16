import { describe, it, expect, vi } from 'vitest';
import { createCoalescingBuffer } from '../../electron/services/coalescingBuffer';

describe('coalescingBuffer', () => {
  it('flushes a single push on next tick', async () => {
    const flush = vi.fn();
    const buf = createCoalescingBuffer(flush);
    buf.push('abc');
    expect(flush).not.toHaveBeenCalled();
    await new Promise(r => setImmediate(r));
    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush).toHaveBeenCalledWith('abc');
  });

  it('coalesces multiple pushes within a tick into one flush', async () => {
    const flush = vi.fn();
    const buf = createCoalescingBuffer(flush);
    buf.push('a');
    buf.push('b');
    buf.push('c');
    await new Promise(r => setImmediate(r));
    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush).toHaveBeenCalledWith('abc');
  });

  it('a forceFlush sends synchronously and cancels the scheduled flush', () => {
    const flush = vi.fn();
    const buf = createCoalescingBuffer(flush);
    buf.push('a');
    buf.push('b');
    buf.forceFlush();
    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush).toHaveBeenCalledWith('ab');
  });

  it('forceFlush with empty buffer is a no-op', () => {
    const flush = vi.fn();
    const buf = createCoalescingBuffer(flush);
    buf.forceFlush();
    expect(flush).not.toHaveBeenCalled();
  });

  it('separate tick groups produce separate flushes', async () => {
    const flush = vi.fn();
    const buf = createCoalescingBuffer(flush);
    buf.push('a');
    await new Promise(r => setImmediate(r));
    buf.push('b');
    await new Promise(r => setImmediate(r));
    expect(flush).toHaveBeenCalledTimes(2);
    expect(flush).toHaveBeenNthCalledWith(1, 'a');
    expect(flush).toHaveBeenNthCalledWith(2, 'b');
  });
});
