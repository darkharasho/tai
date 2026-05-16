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

  it('splits a large push into MAX_CHUNK-sized flushes across ticks', async () => {
    const flush = vi.fn();
    const buf = createCoalescingBuffer(flush);
    const big = 'x'.repeat(64 * 1024 * 3 + 10); // ~3 chunks + a tail
    buf.push(big);
    await new Promise(r => setImmediate(r));
    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush.mock.calls[0][0].length).toBe(64 * 1024);
    await new Promise(r => setImmediate(r));
    expect(flush).toHaveBeenCalledTimes(2);
    await new Promise(r => setImmediate(r));
    expect(flush).toHaveBeenCalledTimes(3);
    await new Promise(r => setImmediate(r));
    expect(flush).toHaveBeenCalledTimes(4);
    // Total bytes flushed == big.length
    const total = flush.mock.calls.reduce((n, [chunk]) => n + chunk.length, 0);
    expect(total).toBe(big.length);
    // Final chunk is the small tail
    expect(flush.mock.calls[3][0].length).toBe(10);
  });

  it('forceFlush drains a large pending buffer synchronously in MAX_CHUNK pieces', () => {
    const flush = vi.fn();
    const buf = createCoalescingBuffer(flush);
    const big = 'y'.repeat(64 * 1024 * 2 + 5);
    buf.push(big);
    buf.forceFlush();
    // All bytes drained synchronously; chunked into 64K + 64K + 5
    expect(flush).toHaveBeenCalledTimes(3);
    const total = flush.mock.calls.reduce((n, [chunk]) => n + chunk.length, 0);
    expect(total).toBe(big.length);
    expect(flush.mock.calls[2][0].length).toBe(5);
  });
});
