// @vitest-environment jsdom
/**
 * The terminal's mode wiring, exercised through the same hook TerminalSession
 * uses. The component holds no mode logic of its own — it forwards segmenter
 * and termios events into these methods and reads `modeState` back — so
 * breaking the wiring breaks these tests.
 */
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTerminalMode, type TerminalModeApi, type TermiosReading } from '@/hooks/useTerminalMode';
import { BlockSegmenter } from '@/components/BlockSegmenter';
import { deriveInputSurface } from '@/utils/inputSurface';

const raw: TermiosReading = { icanon: false, echo: true };
const cooked: TermiosReading = { icanon: true, echo: true };
const CURSOR_HIDE = '\x1b[?25l';

function osc133(letter: string) {
  return `\x1b]133;${letter}\x07`;
}

/** The same projection TerminalSession makes at its deriveInputSurface call. */
function surfaceOf(mode: TerminalModeApi) {
  const owner = mode.modeState.inputOwner;
  return deriveInputSurface({
    altScreenVisible: owner === 'fullscreen',
    interactiveMode: owner === 'program' || owner === 'fullscreen',
    interactiveFullscreen: owner === 'fullscreen',
    awaitingInput: false,
    passwordPrompt: false,
  });
}

function setup() {
  let renders = 0;
  const view = renderHook(() => { renders++; return useTerminalMode(); });
  const mode = () => view.result.current;
  // The single subscription TerminalSession makes.
  const attach = (seg: BlockSegmenter) => {
    seg.onModeSignal(s => act(() => mode().onModeSignal(s)));
    return seg;
  };
  return { view, mode, attach, surface: () => surfaceOf(mode()), renders: () => renders };
}

describe('useTerminalMode', () => {
  it('a transient ICANON drop moves the surface and the restore moves it back', () => {
    // `brew`/`npm` clear ICANON for a progress bar and restore it a tick later.
    // The 500ms debounce used to swallow the first reading entirely. It is gone:
    // filtering an AUTHORITATIVE signal on a timer only delays the correction of
    // a bad guess, and the flip no longer costs output (Task 9's retention is
    // gated on provenance, and both of these readings are authoritative).
    const t = setup();
    act(() => t.mode().onTermios(raw));
    expect(t.surface()).toBe('docked');
    expect(t.mode().modeState.provenance).toBe('authoritative');

    act(() => t.mode().onTermios(cooked));

    expect(t.surface()).toBe('composer');
    expect(t.mode().modeState.inputOwner).toBe('shell');
  });

  it('a raw-mode program docks the moment termios says so, with no delay', () => {
    const t = setup();
    act(() => t.mode().onTermios(raw));

    expect(t.surface()).toBe('docked');
    expect(t.mode().modeState.inputOwner).toBe('program');
    expect(t.mode().modeState.provenance).toBe('authoritative');
  });

  it('an authoritative cooked reading overrules a stale TUI guess immediately', () => {
    // The pre-migration ordering: the reposition regex fires instantly, termios
    // arrives up to 700ms later (200ms poll + 500ms debounce) and was allowed to
    // correct the guess only after that whole window.
    const t = setup();
    const seg = t.attach(new BlockSegmenter());
    seg.feed(osc133('A'));
    seg.feed('$ ');
    seg.feed(osc133('B'));
    seg.feed('brew install foo\n');
    seg.feed(osc133('C'));
    seg.feed('\x1b[2A');
    expect(t.surface()).toBe('docked');
    expect(t.mode().modeState.provenance).toBe('inferred');

    act(() => t.mode().onTermios(cooked));

    expect(t.surface()).toBe('composer');
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
    expect(t.mode().modeState.provenance).toBe('authoritative');
    expect(t.surface()).toBe('fullscreen');

    // And it is NOT revocable: htop is fullscreen and raw at once, and a cooked
    // reading arriving mid-TUI must not knock it back to the composer.
    act(() => t.mode().onTermios(cooked));
    expect(t.surface()).toBe('fullscreen');

    seg.feed('\x1b[?1049l');
    expect(t.surface()).toBe('composer');
  });

  it('an inferred TUI redraw docks instead of faking an alt screen', () => {
    // THE ONE DELIBERATE SURFACE CHANGE in this migration. Pre-migration, the
    // cursor-reposition regex latched _inAltScreen and rendered 'fullscreen';
    // an Ink app like `claude` never switches screens, so that was a guess
    // dressed up as an observation — and it is why claude-ink and python-repl
    // were pinned KNOWN-BAD in the replay corpus. tuiHint resolves to 'program',
    // which renders 'docked'.
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
    expect(t.surface()).toBe('docked');
  });

  it('a legacy cursor-hide takeover keeps its fullscreen surface under a raw reading', () => {
    // Non-integrated shell: the segmenter reports a REVOCABLE fullscreen. A raw
    // reading corroborates it, so the takeover holds — downgrading to 'program'
    // here would drop a full TUI to the docked surface mid-draw.
    const t = setup();
    const seg = t.attach(new BlockSegmenter());
    seg.feed('user@host:~$ ');
    seg.feed(CURSOR_HIDE);
    expect(t.surface()).toBe('fullscreen');
    // Labelled inferred, not authoritative: a cursor hide is not proof of a
    // screen takeover, and retention must not drop bytes on it.
    expect(t.mode().modeState.provenance).toBe('inferred');

    act(() => t.mode().onTermios(raw));

    expect(t.surface()).toBe('fullscreen');
    expect(t.mode().modeState.provenance).toBe('inferred');
  });

  it('a legacy cursor-hide takeover still falls back on a cooked reading', () => {
    // A cooked spinner that hides the cursor: this takeover is revocable, and
    // the pre-migration code revoked it here. It is why the cursor-hide path
    // emits fullscreenHint rather than altScreen — the latter would survive.
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

  it('the end of a block returns ownership to the shell', () => {
    const t = setup();
    act(() => t.mode().onTermios(raw));
    expect(t.surface()).toBe('docked');

    act(() => t.mode().onCommandEnd());

    expect(t.mode().modeState.inputOwner).toBe('shell');
    expect(t.surface()).toBe('composer');
  });

  it('reset() publishes the initial state, not just the resolver internals', () => {
    const t = setup();
    act(() => t.mode().onTermios(raw));
    act(() => t.mode().reset());

    expect(t.mode().modeState.inputOwner).toBe('shell');
    expect(t.surface()).toBe('composer');
  });
});
