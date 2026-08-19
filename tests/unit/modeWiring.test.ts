import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BlockSegmenter } from '@/components/BlockSegmenter';
import { createModeResolver, type ModeState } from '@/utils/terminalMode';
import { legacyFlagsFromMode, sameModeState } from '@/utils/modeFlags';
import { createRawModeGate, type TermiosReading } from '@/utils/rawModeGate';
import { deriveInputSurface } from '@/utils/inputSurface';

const CURSOR_HIDE = '\x1b[?25l';
const CURSOR_SHOW = '\x1b[?25h';
const raw: TermiosReading = { icanon: false, echo: true, interactiveProgram: true };
const cooked: TermiosReading = { icanon: true, echo: true, interactiveProgram: false };

/**
 * The exact wiring TerminalSession performs, minus React. The shared pieces
 * (`legacyFlagsFromMode`, `sameModeState`, `createRawModeGate`) are the same
 * units the component uses, so this pins the composition rather than a
 * paraphrase of it.
 */
function wiring() {
  const seg = new BlockSegmenter();
  const resolver = createModeResolver();
  const flags = { altScreenVisible: false, interactiveMode: false, interactiveFullscreen: false };
  let mode: ModeState = resolver.state;

  // React only re-runs the derive effect when the state object actually
  // changes, so a no-op reading must not clobber the legacy setters.
  let derives = 0;
  const commit = (next: ModeState) => {
    if (sameModeState(mode, next)) return;
    mode = next;
    derives++;
    Object.assign(flags, legacyFlagsFromMode(next));
  };

  seg.onAltScreen(entered => { flags.altScreenVisible = entered; });
  seg.onInteractiveMode((entered, fullscreen) => {
    flags.interactiveMode = entered;
    flags.interactiveFullscreen = entered && !!fullscreen;
  });
  seg.onModeSignal(signal => commit(resolver.apply(signal)));

  const gate = createRawModeGate({
    isActive: () => flags.interactiveMode,
    onActivate: r => {
      flags.interactiveMode = true;
      flags.interactiveFullscreen = false;
      commit(resolver.apply({ kind: 'termios', icanon: r.icanon, echo: r.echo }));
    },
    onDeactivate: r => {
      flags.interactiveMode = false;
      commit(resolver.apply({ kind: 'termios', icanon: r.icanon, echo: r.echo }));
    },
  });

  const surface = () => deriveInputSurface({ ...flags, awaitingInput: false, passwordPrompt: false });
  return { seg, gate, flags, surface, mode: () => mode, derives: () => derives };
}

describe('mode wiring (segmenter + resolver + termios gate)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('transient ICANON flicker never moves the input surface', () => {
    const w = wiring();
    w.seg.feed('user@host:~$ ');
    expect(w.surface()).toBe('composer');

    w.gate.update(raw);            // `brew` drops ICANON for a progress bar
    vi.advanceTimersByTime(200);
    expect(w.surface()).toBe('composer');
    w.gate.update(cooked);         // …and restores it before the debounce fires
    vi.advanceTimersByTime(5000);

    expect(w.surface()).toBe('composer');
    expect(w.flags.interactiveMode).toBe(false);
  });

  it('a persistent raw-mode program still docks after the debounce', () => {
    const w = wiring();
    w.seg.feed('user@host:~$ ');
    w.gate.update(raw);
    vi.advanceTimersByTime(500);
    expect(w.surface()).toBe('docked');
    expect(w.mode().inputOwner).toBe('program');
  });

  it('legacy CURSOR_HIDE stays fullscreen when the termios poll reports raw mode', () => {
    const w = wiring();
    w.seg.feed('user@host:~$ ');
    w.seg.feed(CURSOR_HIDE);
    expect(w.surface()).toBe('fullscreen');
    // The resolver still says 'shell' here: this takeover is revocable by a
    // cooked reading (see the next test) and no signal expresses that yet. What
    // keeps the surface right is the gate — the raw reading is never committed
    // while raw mode is already active, so the resolver is never told 'program'
    // and the derive effect never downgrades fullscreen to docked.
    expect(w.mode().inputOwner).toBe('shell');

    w.gate.update(raw);
    vi.advanceTimersByTime(5000);

    expect(w.surface()).toBe('fullscreen');
  });

  it('legacy CURSOR_HIDE under a cooked reading falls back exactly as it does today', () => {
    // A cooked spinner that hides the cursor: today the next cooked poll clears
    // interactiveMode and the surface returns to the composer. A no-op resolver
    // reading must not resurrect it.
    const w = wiring();
    w.seg.feed('user@host:~$ ');
    w.seg.feed(CURSOR_HIDE);
    expect(w.surface()).toBe('fullscreen');

    w.gate.update(cooked);

    expect(w.surface()).toBe('composer');
  });

  it('a reading that carries no news does not re-derive the flags', () => {
    // The echo poller fires every 200ms and the resolver hands back a fresh
    // object every time. Without the no-news check each tick would re-run the
    // derive effect and overwrite whatever the legacy callbacks had just set —
    // and re-render the whole session five times a second for nothing.
    const w = wiring();
    w.seg.feed('user@host:~$ ');
    w.gate.update(cooked);
    const before = w.derives();

    w.gate.update(cooked);
    w.gate.update(cooked);
    w.gate.update(cooked);

    expect(w.derives()).toBe(before);
  });

  it('CURSOR_SHOW leaves the shell owning the input', () => {
    const w = wiring();
    w.seg.feed('user@host:~$ ');
    w.seg.feed(CURSOR_HIDE);
    w.seg.feed(CURSOR_SHOW);
    expect(w.mode().inputOwner).toBe('shell');
    expect(w.surface()).toBe('composer');
  });

  it('a docked REPL is cleared by the resolver when a cooked reading arrives', () => {
    const w = wiring();
    w.seg.feed('user@host:~$ ');
    w.gate.update(raw);
    vi.advanceTimersByTime(500);
    expect(w.surface()).toBe('docked');

    w.gate.update(cooked);

    expect(w.surface()).toBe('composer');
    expect(w.mode().inputOwner).toBe('shell');
  });
});
