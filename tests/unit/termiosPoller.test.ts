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
    p.start();                    // seeded baseline (on,on); first read matches → no event
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
    p.start();                    // seeded baseline (on,on); first read matches → no event
    vi.advanceTimersByTime(200);  // raw mode → event
    expect(onChange).toHaveBeenCalledWith({ echo: false, icanon: false, passwordPrompt: false, interactiveProgram: true });
  });

  it('flags interactiveProgram for an echo-on raw-mode REPL (python, node)', () => {
    const read = vi.fn()
      .mockReturnValueOnce({ echo: true, icanon: true })
      .mockReturnValue({ echo: true, icanon: false });
    const onChange = vi.fn();
    const p = new TermiosPoller(123, read, onChange);
    p.start();                    // seeded baseline (on,on); first read matches → no event
    vi.advanceTimersByTime(200);  // raw mode → event
    expect(onChange).toHaveBeenCalledWith({ echo: true, icanon: false, passwordPrompt: false, interactiveProgram: true });
  });

  it('reports a program that was already in raw mode when the poller was armed', () => {
    // The regression this seeded baseline exists for. The poller is armed at
    // the OSC 133 output marker, so a program that goes raw the instant it
    // starts (top, htop, less) has already flipped the tty by then. Snapshotting
    // the tty here baked raw mode into the baseline and the transition was
    // never reported, leaving stdin on the composer while a TUI owned the
    // screen — pressing `q` in top typed a literal q.
    const read = vi.fn().mockReturnValue({ echo: false, icanon: false });
    const onChange = vi.fn();
    const p = new TermiosPoller(123, read, onChange);
    p.start();                    // evaluates immediately against the seed
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith({
      echo: false, icanon: false, passwordPrompt: false, interactiveProgram: true,
    });
  });

  it('reports a password prompt that was already up when the poller was armed', () => {
    // Same shape, cooked variant: sudo prompts before the poller is armed.
    const read = vi.fn().mockReturnValue({ echo: false, icanon: true });
    const onChange = vi.fn();
    const p = new TermiosPoller(123, read, onChange);
    p.start();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ passwordPrompt: true, interactiveProgram: false }),
    );
  });

  it('stays quiet for an ordinary command that never leaves canonical mode', () => {
    // The seed must not manufacture an event for the common case.
    const read = vi.fn().mockReturnValue({ echo: true, icanon: true });
    const onChange = vi.fn();
    const p = new TermiosPoller(123, read, onChange);
    p.start();
    vi.advanceTimersByTime(1000);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('resetBaseline() forces a re-emit of an otherwise-unchanged password-prompt state', () => {
    // Chained sudo collapses the echo off→on→off transition into one poll
    // window, so the edge detector never re-fires for the second prompt.
    // resetBaseline() makes the next identical read count as a change.
    const read = vi.fn().mockReturnValue({ echo: false, icanon: true });
    const onChange = vi.fn();
    const p = new TermiosPoller(123, read, onChange);
    p.start();                    // first prompt: (off,on) != seed → fires
    expect(onChange).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(200);  // second prompt reads the same → no event
    expect(onChange).toHaveBeenCalledTimes(1);
    p.resetBaseline();            // baseline → shell-like (on,on)
    vi.advanceTimersByTime(200);  // (off,on) != (on,on) → re-fires
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ passwordPrompt: true }),
    );
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
