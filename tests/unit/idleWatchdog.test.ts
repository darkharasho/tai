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
