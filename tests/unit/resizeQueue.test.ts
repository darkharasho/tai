import { describe, it, expect, vi } from 'vitest';
import { createResizeQueue } from '../../electron/services/resizeQueue';

describe('resizeQueue', () => {
  it('applies a single enqueued resize on next tick', async () => {
    const apply = vi.fn();
    const q = createResizeQueue(apply);
    q.enqueue(80, 24);
    expect(apply).not.toHaveBeenCalled();
    await new Promise(r => setImmediate(r));
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(80, 24);
  });

  it('coalesces rapid enqueues into first + last (last-write-wins)', async () => {
    const apply = vi.fn();
    const q = createResizeQueue(apply);
    q.enqueue(80, 24);
    q.enqueue(100, 30);
    q.enqueue(120, 40);
    // First call drains on the immediate; queue then re-applies the latest pending.
    await new Promise(r => setImmediate(r));
    await new Promise(r => setImmediate(r));
    expect(apply).toHaveBeenCalledTimes(2);
    expect(apply).toHaveBeenNthCalledWith(1, 80, 24);
    expect(apply).toHaveBeenNthCalledWith(2, 120, 40);
  });

  it('settles after the final geometry is applied', async () => {
    const apply = vi.fn();
    const q = createResizeQueue(apply);
    q.enqueue(80, 24);
    q.enqueue(100, 30);
    await new Promise(r => setImmediate(r));
    await new Promise(r => setImmediate(r));
    apply.mockClear();
    await new Promise(r => setImmediate(r));
    expect(apply).not.toHaveBeenCalled();
  });

  it('a new enqueue after settle starts a fresh cycle', async () => {
    const apply = vi.fn();
    const q = createResizeQueue(apply);
    q.enqueue(80, 24);
    await new Promise(r => setImmediate(r));
    q.enqueue(100, 30);
    await new Promise(r => setImmediate(r));
    expect(apply).toHaveBeenCalledTimes(2);
    expect(apply).toHaveBeenNthCalledWith(2, 100, 30);
  });
});
