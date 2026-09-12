// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';

const focus = vi.fn();

vi.mock('@xterm/xterm/css/xterm.css', () => ({}));
vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    options: Record<string, unknown> = {};
    buffer = { active: { length: 0, getLine: () => null } };
    loadAddon() {}
    open() {}
    attachCustomKeyEventHandler() {}
    onData() {}
    dispose() {}
    refresh() {}
    focus = focus;
    blur() {}
    write() {}
    clear() {}
  },
}));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() {} } }));

import { HiddenXterm } from '../../src/components/HiddenXterm';

beforeEach(() => {
  vi.useFakeTimers();
  focus.mockReset();
  (window as any).tai = { pty: { write: vi.fn(), resize: vi.fn() } };
  (globalThis as any).ResizeObserver = class { observe() {} disconnect() {} };
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** Runs both fit passes (rAF + 150 ms). */
function runFitPasses() {
  act(() => { vi.advanceTimersByTime(200); });
}

describe('HiddenXterm focus', () => {
  it('without suppressFocus, the fit pass and window focus focus the xterm', () => {
    render(<HiddenXterm ptyId={1} visible />);
    runFitPasses();
    expect(focus).toHaveBeenCalled();
    focus.mockReset();
    act(() => { window.dispatchEvent(new Event('focus')); });
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it('with suppressFocus, neither the fit pass nor window focus focuses the xterm', () => {
    render(<HiddenXterm ptyId={1} visible suppressFocus />);
    runFitPasses();
    act(() => { window.dispatchEvent(new Event('focus')); });
    expect(focus).not.toHaveBeenCalled();
  });

  it('follows suppressFocus changes after mount', () => {
    const { rerender } = render(<HiddenXterm ptyId={1} visible={false} />);
    rerender(<HiddenXterm ptyId={1} visible suppressFocus />);
    runFitPasses();
    act(() => { window.dispatchEvent(new Event('focus')); });
    expect(focus).not.toHaveBeenCalled();
    rerender(<HiddenXterm ptyId={1} visible suppressFocus={false} />);
    act(() => { window.dispatchEvent(new Event('focus')); });
    expect(focus).toHaveBeenCalledTimes(1);
  });
});
