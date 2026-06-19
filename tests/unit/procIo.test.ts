import { describe, it, expect, vi } from 'vitest';
import { safeWrite } from '../../electron/services/procIo';

describe('safeWrite', () => {
  it('writes and returns true on a writable stream', () => {
    const write = vi.fn();
    const ok = safeWrite({ stdin: { write } as any }, 'hello\n');
    expect(ok).toBe(true);
    expect(write).toHaveBeenCalledWith('hello\n');
  });

  it('returns false and calls onError when proc is null', () => {
    const onError = vi.fn();
    expect(safeWrite(null, 'x', onError)).toBe(false);
    expect(onError).toHaveBeenCalledOnce();
  });

  it('returns false and calls onError when write throws', () => {
    const onError = vi.fn();
    const write = vi.fn(() => { throw new Error('EPIPE'); });
    expect(safeWrite({ stdin: { write } as any }, 'x', onError)).toBe(false);
    expect(onError).toHaveBeenCalledOnce();
  });
});
