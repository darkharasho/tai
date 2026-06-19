import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TermiosPoller } from '../../electron/services/termiosPoller';

describe('TermiosPoller', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('does not poll until start() is called', () => {
    const read = vi.fn().mockReturnValue({ echo: true, icanon: true });
    const onChange = vi.fn();
    new TermiosPoller(123, read, onChange);
    vi.advanceTimersByTime(5000);
    expect(read).not.toHaveBeenCalled();
  });

  it('fires onChange when ECHO transitions off (and ICANON stays on)', () => {
    const states = [
      { echo: true, icanon: true },
      { echo: true, icanon: true },
      { echo: false, icanon: true },
    ];
    let i = 0;
    const read = vi.fn(() => states[Math.min(i++, states.length - 1)]);
    const onChange = vi.fn();
    const p = new TermiosPoller(123, read, onChange);
    p.start();                    // baseline captured synchronously
    vi.advanceTimersByTime(200);  // no change
    vi.advanceTimersByTime(200);  // echo off → event
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith({ echo: false, icanon: true, passwordPrompt: true, interactiveProgram: false });
  });

  it('does not flag passwordPrompt when ICANON is also off (vim-style raw mode), but flags interactiveProgram', () => {
    const read = vi.fn()
      .mockReturnValueOnce({ echo: true, icanon: true })
      .mockReturnValue({ echo: false, icanon: false });
    const onChange = vi.fn();
    const p = new TermiosPoller(123, read, onChange);
    p.start();                    // baseline captured synchronously
    vi.advanceTimersByTime(200);  // raw mode → event
    expect(onChange).toHaveBeenCalledWith({ echo: false, icanon: false, passwordPrompt: false, interactiveProgram: true });
  });

  it('flags interactiveProgram for an echo-on raw-mode REPL (python, node)', () => {
    const read = vi.fn()
      .mockReturnValueOnce({ echo: true, icanon: true })
      .mockReturnValue({ echo: true, icanon: false });
    const onChange = vi.fn();
    const p = new TermiosPoller(123, read, onChange);
    p.start();                    // baseline captured synchronously
    vi.advanceTimersByTime(200);  // raw mode → event
    expect(onChange).toHaveBeenCalledWith({ echo: true, icanon: false, passwordPrompt: false, interactiveProgram: true });
  });

  it('stop() halts the poll loop', () => {
    const read = vi.fn().mockReturnValue({ echo: true, icanon: true });
    const p = new TermiosPoller(123, read, vi.fn());
    p.start();
    vi.advanceTimersByTime(1000);
    p.stop();
    const callsBefore = read.mock.calls.length;
    vi.advanceTimersByTime(5000);
    expect(read.mock.calls.length).toBe(callsBefore);
  });
});
