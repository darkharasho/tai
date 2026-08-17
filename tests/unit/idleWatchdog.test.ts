import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createIdleWatchdog } from '../../electron/services/idleWatchdog';

describe('createIdleWatchdog', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('fires onIdle after idleMs with no kick', () => {
    const onIdle = vi.fn();
    const wd = createIdleWatchdog({ idleMs: 1000, onIdle });
    wd.kick();
    vi.advanceTimersByTime(1001);
    expect(onIdle).toHaveBeenCalledOnce();
  });

  it('does not fire while kicked within idleMs', () => {
    const onIdle = vi.fn();
    const wd = createIdleWatchdog({ idleMs: 1000, onIdle });
    wd.kick();
    vi.advanceTimersByTime(800);
    wd.kick();
    vi.advanceTimersByTime(800);
    expect(onIdle).not.toHaveBeenCalled();
  });

  it('cancel() prevents onIdle', () => {
    const onIdle = vi.fn();
    const wd = createIdleWatchdog({ idleMs: 1000, onIdle });
    wd.kick();
    wd.cancel();
    vi.advanceTimersByTime(2000);
    expect(onIdle).not.toHaveBeenCalled();
  });

  it('fires onIdle at most once', () => {
    const onIdle = vi.fn();
    const wd = createIdleWatchdog({ idleMs: 1000, onIdle });
    wd.kick();
    vi.advanceTimersByTime(5000);
    expect(onIdle).toHaveBeenCalledOnce();
  });

  it('does not fire while paused, however long the wait', () => {
    const onIdle = vi.fn();
    const wd = createIdleWatchdog({ idleMs: 1000, onIdle });
    wd.kick();
    wd.pause();
    vi.advanceTimersByTime(10_000);
    expect(onIdle).not.toHaveBeenCalled();
  });

  it('restarts a full interval on resume()', () => {
    const onIdle = vi.fn();
    const wd = createIdleWatchdog({ idleMs: 1000, onIdle });
    wd.kick();
    wd.pause();
    vi.advanceTimersByTime(10_000);
    wd.resume();
    vi.advanceTimersByTime(900);
    expect(onIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(onIdle).toHaveBeenCalledOnce();
  });

  it('stays paused until every nested pause is resumed', () => {
    const onIdle = vi.fn();
    const wd = createIdleWatchdog({ idleMs: 1000, onIdle });
    wd.kick();
    wd.pause();
    wd.pause();
    wd.resume();
    vi.advanceTimersByTime(5000);
    expect(onIdle).not.toHaveBeenCalled();
    wd.resume();
    vi.advanceTimersByTime(1001);
    expect(onIdle).toHaveBeenCalledOnce();
  });

  it('ignores kick() while paused', () => {
    const onIdle = vi.fn();
    const wd = createIdleWatchdog({ idleMs: 1000, onIdle });
    wd.pause();
    wd.kick();
    vi.advanceTimersByTime(5000);
    expect(onIdle).not.toHaveBeenCalled();
  });

  it('cancel() wins over a pending resume()', () => {
    const onIdle = vi.fn();
    const wd = createIdleWatchdog({ idleMs: 1000, onIdle });
    wd.kick();
    wd.pause();
    wd.cancel();
    wd.resume();
    vi.advanceTimersByTime(5000);
    expect(onIdle).not.toHaveBeenCalled();
  });

  it('does not re-arm after cancel()', () => {
    const onIdle = vi.fn();
    const wd = createIdleWatchdog({ idleMs: 1000, onIdle });
    wd.kick();
    wd.cancel();
    wd.kick();
    vi.advanceTimersByTime(2000);
    expect(onIdle).not.toHaveBeenCalled();
  });
});
