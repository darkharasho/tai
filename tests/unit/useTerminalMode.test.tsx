// @vitest-environment jsdom
/**
 * The terminal's mode wiring, exercised through the same hook TerminalSession
 * uses. The component holds no mode logic of its own — it forwards segmenter
 * and termios events into these methods and reads `modeState` back — so
 * breaking the wiring breaks these tests.
 */
import { describe, it, expect } from 'vitest';
import { useCallback } from 'react';
import { renderHook, act } from '@testing-library/react';
import { useTerminalMode, type TerminalModeApi, type TermiosReading } from '@/hooks/useTerminalMode';
import type { ModeState } from '@/utils/terminalMode';
import { BlockSegmenter } from '@/components/BlockSegmenter';
import { deriveInputSurface } from '@/utils/inputSurface';
import { inputSignalsFromMode } from '@/utils/modeFlags';

const raw: TermiosReading = { icanon: false, echo: true };
const cooked: TermiosReading = { icanon: true, echo: true };
const CURSOR_HIDE = '\x1b[?25l';

function osc133(letter: string) {
  return `\x1b]133;${letter}\x07`;
}

/**
 * Literally the projection TerminalSession makes — the same function, not a
 * copy of its logic. Re-implementing it here would let the component's mapping
 * break while these tests kept reporting the right surfaces.
 */
function surfaceOf(mode: TerminalModeApi) {
  return deriveInputSurface({
    ...inputSignalsFromMode(mode.modeState),
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

  it('a real alt screen supersedes a revocable takeover without a visible gap', () => {
    // The revocable claim is explicitly ended before the alt screen is
    // announced, so consumers see the exit. The surface must not flicker back
    // to the composer in between.
    const t = setup();
    const seg = t.attach(new BlockSegmenter());
    seg.feed('user@host:~$ ');
    seg.feed(CURSOR_HIDE);
    seg.feed('\x1b[?1049h');

    expect(t.surface()).toBe('fullscreen');
    expect(t.mode().modeState.provenance).toBe('authoritative');

    // And having been upgraded, it is no longer revocable.
    act(() => t.mode().onTermios(cooked));
    expect(t.surface()).toBe('fullscreen');
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

  it('every resolved state reaches the segmenter, so retention sees the live mode', () => {
    // TerminalSession installs exactly this sink. The segmenter needs the mode
    // on the same tick as the bytes that produced it, so a wiring that only
    // updated React state would leave retention deciding against a stale mode
    // - the race this migration exists to remove. Driven end to end rather
    // than by asserting on a spy: the point is that the block keeps its output.
    const seg = new BlockSegmenter();
    const blocks: any[] = [];
    seg.onBlock(b => blocks.push(b));
    const view = renderHook(() =>
      useTerminalMode(useCallback((state: ModeState) => seg.setModeState(state), [])));
    seg.onModeSignal(s => act(() => view.result.current.onModeSignal(s)));

    seg.feed(osc133('A'));
    seg.feed('$ ');
    seg.feed(osc133('B'));
    seg.feed('brew install foo\n');
    seg.feed(osc133('C'));
    // Cursor-up redraw: the guess that used to discard everything after it.
    seg.feed('\x1b[2A');
    seg.feed('==> Downloading foo\n');
    act(() => view.result.current.onTermios(cooked));
    seg.feed(osc133('D;0'));
    seg.feed(osc133('A'));

    expect(view.result.current.modeState).toMatchObject({
      inputOwner: 'shell', provenance: 'authoritative',
    });
    expect(blocks).toHaveLength(1);
    expect(blocks[0].output).toContain('Downloading foo');
  });

  // Task 10. TerminalSession synthesizes onCommandEnd from the segmenter's own
  // prompt heuristics — not from an OSC 133 marker — so it must carry the
  // boundary semantics without the proof-of-integration. Wiring it as a real
  // 'prompt' (as the resolver's other boundary callers do) leaves every
  // resolver unit test green while silently letting a degraded remote session
  // clear its own degradation on the first heuristic prompt match, after which
  // nothing re-declares it and the whole feature is off for the session.
  it('a block boundary is a boundary, not evidence that shell integration exists', () => {
    const t = setup();
    act(() => t.mode().onModeSignal({ kind: 'sourceUnavailable', source: 'hooks' }));
    expect(t.mode().modeState.degradedReason).toBe('no-hooks');

    act(() => t.mode().onCommandEnd());

    // Boundary semantics intact...
    expect(t.mode().modeState.inputOwner).toBe('shell');
    expect(t.mode().modeState.commandRunning).toBe(false);
    // ...and the gap is still open, on the field the chip reads and on the
    // provenance of the very decision hooks would have made authoritatively.
    expect(t.mode().modeState.degradedReason).toBe('no-hooks');
    expect(t.mode().modeState.provenance).toBe('degraded');
  });

  // The end-to-end shape of the ConPTY fallback, through the same projection
  // the component uses. On win32 no TermiosPoller is ever constructed
  // (electron/services/pty.ts guards on process.platform), so onTermios is
  // never called, the gap is never healed, and this is the only thing that
  // gets the user a surface they can type into.
  it('a declared gap reaches the input surface as the live terminal', () => {
    const t = setup();
    const surfaceWhileRunning = () => deriveInputSurface({
      ...inputSignalsFromMode(t.mode().modeState),
      awaitingInput: false,
      passwordPrompt: false,
      degraded: t.mode().modeState.provenance === 'degraded',
      commandRunning: true,
    });

    // No gap declared: the composer, because the real signals are trusted.
    expect(surfaceWhileRunning()).toBe('composer');

    act(() => t.mode().onModeSignal({ kind: 'sourceUnavailable', source: 'termios' }));
    expect(surfaceWhileRunning()).toBe('docked');

    // Alt-screen programs still get their own surface, and leaving one returns
    // to the fallback rather than to a false claim of authority.
    act(() => t.mode().onModeSignal({ kind: 'altScreen', entered: true }));
    expect(surfaceWhileRunning()).toBe('fullscreen');
    act(() => t.mode().onModeSignal({ kind: 'altScreen', entered: false }));
    expect(surfaceWhileRunning()).toBe('docked');
  });

  it('reset() publishes the initial state, not just the resolver internals', () => {
    const t = setup();
    act(() => t.mode().onTermios(raw));
    act(() => t.mode().reset());

    expect(t.mode().modeState.inputOwner).toBe('shell');
    expect(t.surface()).toBe('composer');
  });
});
