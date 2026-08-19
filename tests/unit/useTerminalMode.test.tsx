// @vitest-environment jsdom
/**
 * The terminal's mode wiring, exercised through the same hook TerminalSession
 * uses. The component holds no mode logic of its own — it forwards segmenter
 * and termios events into these methods and reads the flags back — so breaking
 * the wiring breaks these tests.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTerminalMode, type TerminalModeApi } from '@/hooks/useTerminalMode';
import { BlockSegmenter } from '@/components/BlockSegmenter';
import { deriveInputSurface } from '@/utils/inputSurface';
import type { TermiosReading } from '@/utils/rawModeGate';

const raw: TermiosReading = { icanon: false, echo: true, interactiveProgram: true };
const cooked: TermiosReading = { icanon: true, echo: true, interactiveProgram: false };
const CURSOR_HIDE = '\x1b[?25l';

function osc133(letter: string) {
  return `\x1b]133;${letter}\x07`;
}

function surfaceOf(mode: TerminalModeApi) {
  return deriveInputSurface({
    altScreenVisible: mode.altScreenVisible,
    interactiveMode: mode.interactiveMode,
    interactiveFullscreen: mode.interactiveFullscreen,
    awaitingInput: false,
    passwordPrompt: false,
  });
}

function setup() {
  let renders = 0;
  const view = renderHook(() => { renders++; return useTerminalMode(); });
  const mode = () => view.result.current;
  // Exactly the three subscriptions TerminalSession makes.
  const attach = (seg: BlockSegmenter) => {
    seg.onModeSignal(s => act(() => mode().onModeSignal(s)));
    seg.onAltScreen(e => act(() => mode().onLegacyAltScreen(e)));
    seg.onInteractiveMode((e, f) => act(() => mode().onLegacyInteractive(e, f)));
    return seg;
  };
  return { view, mode, attach, surface: () => surfaceOf(mode()), renders: () => renders };
}

describe('useTerminalMode', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('a transient ICANON drop never moves the input surface', () => {
    // `brew`/`npm` clear ICANON for a progress bar and restore it a tick later.
    const t = setup();
    act(() => t.mode().onTermios(raw));
    act(() => { vi.advanceTimersByTime(200); });
    expect(t.surface()).toBe('composer');

    act(() => t.mode().onTermios(cooked));
    act(() => { vi.advanceTimersByTime(5000); });

    expect(t.surface()).toBe('composer');
    expect(t.mode().interactiveMode).toBe(false);
    expect(t.mode().modeState.inputOwner).toBe('shell');
  });

  it('a raw-mode program that persists docks after the debounce', () => {
    const t = setup();
    act(() => t.mode().onTermios(raw));
    act(() => { vi.advanceTimersByTime(500); });

    expect(t.surface()).toBe('docked');
    expect(t.mode().modeState.inputOwner).toBe('program');
    expect(t.mode().modeState.provenance).toBe('authoritative');
  });

  it('a real alt screen owns the whole surface', () => {
    const t = setup();
    const seg = t.attach(new BlockSegmenter());
    seg.feed(osc133('A'));
    seg.feed('$ ');
    seg.feed(osc133('B'));
    seg.feed('htop\n');
    seg.feed(osc133('C'));
    seg.feed('\x1b[?1049h');

    expect(t.mode().modeState.inputOwner).toBe('fullscreen');
    expect(t.mode().altScreenVisible).toBe(true);
    expect(t.mode().interactiveFullscreen).toBe(true);
    expect(t.surface()).toBe('fullscreen');

    seg.feed('\x1b[?1049l');
    expect(t.surface()).toBe('composer');
  });

  it('an inferred TUI redraw docks instead of faking an alt screen', () => {
    // THE ONE DELIBERATE SURFACE CHANGE in this migration. Pre-migration, the
    // cursor-reposition regex latched _inAltScreen and rendered 'fullscreen';
    // an Ink app like `claude` never switches screens, so that was a guess
    // dressed up as an observation — and it is why claude-ink and python-repl
    // are pinned KNOWN-BAD in the replay corpus. tuiHint resolves to 'program',
    // which renders 'docked'. Task 8 keeps this; do not "restore" fullscreen.
    const t = setup();
    const seg = t.attach(new BlockSegmenter());
    seg.feed(osc133('A'));
    seg.feed('$ ');
    seg.feed(osc133('B'));
    seg.feed('claude\n');
    seg.feed(osc133('C'));
    seg.feed('\x1b[2A');

    expect(t.mode().modeState.inputOwner).toBe('program');
    expect(t.mode().modeState.provenance).toBe('inferred');
    expect(t.mode().altScreenVisible).toBe(false);
    expect(t.surface()).toBe('docked');
  });

  it('a legacy cursor-hide takeover keeps its fullscreen surface under a raw reading', () => {
    // Non-integrated shell: the segmenter reports fullscreen via
    // onInteractiveMode(true, true). The echo poller then reports raw mode, and
    // the gate must not commit it — committing would resolve to 'program' and
    // downgrade the surface to docked.
    const t = setup();
    const seg = t.attach(new BlockSegmenter());
    seg.feed('user@host:~$ ');
    seg.feed(CURSOR_HIDE);
    expect(t.surface()).toBe('fullscreen');

    act(() => t.mode().onTermios(raw));
    act(() => { vi.advanceTimersByTime(5000); });

    expect(t.surface()).toBe('fullscreen');
  });

  it('a legacy cursor-hide takeover still falls back on a cooked reading', () => {
    // A cooked spinner that hides the cursor: this takeover is revocable, and
    // the pre-migration code revoked it here. It is why the cursor-hide path
    // emits no altScreen mode signal (that would survive the reading).
    const t = setup();
    const seg = t.attach(new BlockSegmenter());
    seg.feed('user@host:~$ ');
    seg.feed(CURSOR_HIDE);
    expect(t.surface()).toBe('fullscreen');

    act(() => t.mode().onTermios(cooked));

    expect(t.surface()).toBe('composer');
  });

  it('a reading that carries no news does not re-render', () => {
    // The echo poller fires five times a second and the resolver hands back a
    // fresh object every time.
    const t = setup();
    act(() => t.mode().onTermios(cooked));
    const before = t.renders();

    act(() => t.mode().onTermios(cooked));
    act(() => t.mode().onTermios(cooked));
    act(() => t.mode().onTermios(cooked));

    expect(t.renders()).toBe(before);
  });

  it('the end of a block cancels a pending raw-mode commit', () => {
    const t = setup();
    act(() => t.mode().onTermios(raw));
    act(() => t.mode().onCommandEnd());
    act(() => { vi.advanceTimersByTime(5000); });

    expect(t.mode().interactiveMode).toBe(false);
    expect(t.surface()).toBe('composer');
  });
});
