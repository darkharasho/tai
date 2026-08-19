import { useState, useRef, useEffect, useCallback } from 'react';
import { createModeResolver, type ModeSignal, type ModeState } from '@/utils/terminalMode';
import { legacyFlagsFromMode, sameModeState } from '@/utils/modeFlags';
import { createRawModeGate, type RawModeGate, type TermiosReading } from '@/utils/rawModeGate';

/**
 * All of the terminal's mode wiring, in one testable place.
 *
 * TerminalSession forwards events here and reads flags back; it holds no mode
 * logic of its own. That is deliberate: a test that re-implements the wiring
 * can drift from the component silently while still reading as coverage, so
 * the component and the tests have to call the same code.
 *
 * The three flags are the resolver's projection (see legacyFlagsFromMode).
 * Every input surface is preserved except the inferred-TUI path — see
 * onModeSignal below.
 */
export interface TerminalModeApi {
  altScreenVisible: boolean;
  interactiveMode: boolean;
  interactiveFullscreen: boolean;
  modeState: ModeState;
  /** BlockSegmenter.onModeSignal */
  onModeSignal: (signal: ModeSignal) => void;
  /** BlockSegmenter.onAltScreen */
  onLegacyAltScreen: (entered: boolean) => void;
  /** BlockSegmenter.onInteractiveMode */
  onLegacyInteractive: (entered: boolean, fullscreen?: boolean) => void;
  /** A termios reading from the echo poller. */
  onTermios: (reading: TermiosReading) => void;
  /** The block finished, so no raw-mode program can still be foreground. */
  onCommandEnd: () => void;
  reset: () => void;
}

export function useTerminalMode(): TerminalModeApi {
  const [altScreenVisible, setAltScreenVisible] = useState(false);
  const [interactiveMode, setInteractiveMode] = useState(false);
  const [interactiveFullscreen, setInteractiveFullscreen] = useState(false);
  const resolverRef = useRef(createModeResolver());
  const [modeState, setModeState] = useState<ModeState>(() => resolverRef.current.state);

  // Only real transitions may re-derive: the resolver returns a fresh object
  // for every signal, including ones that change nothing, and re-running the
  // effect on those would overwrite flags the legacy callbacks just set — and
  // re-render on every 200ms echo poll for no news.
  const commitMode = useCallback((next: ModeState) => {
    setModeState(prev => (sameModeState(prev, next) ? prev : next));
  }, []);

  useEffect(() => {
    const flags = legacyFlagsFromMode(modeState);
    setAltScreenVisible(flags.altScreenVisible);
    setInteractiveMode(flags.interactiveMode);
    setInteractiveFullscreen(flags.interactiveFullscreen);
  }, [modeState]);

  const interactiveModeRef = useRef(false);
  interactiveModeRef.current = interactiveMode;

  const gateRef = useRef<RawModeGate | null>(null);
  if (!gateRef.current) {
    gateRef.current = createRawModeGate({
      isActive: () => interactiveModeRef.current,
      onActivate: (r) => {
        setInteractiveMode(true);
        // A faithful port of master's debounce timer, which cleared this flag
        // alongside setting interactiveMode. No test pins it because nothing
        // can observe it: onActivate only runs when isActive() was false, and
        // interactiveFullscreen is never true while interactiveMode is false —
        // every path sets the two together. Kept rather than dropped so this
        // step stays a move of master's code, not a rewrite of it.
        setInteractiveFullscreen(false);
        commitMode(resolverRef.current.apply({ kind: 'termios', icanon: r.icanon, echo: r.echo }));
      },
      onDeactivate: (r) => {
        setInteractiveMode(false);
        commitMode(resolverRef.current.apply({ kind: 'termios', icanon: r.icanon, echo: r.echo }));
      },
    });
  }

  useEffect(() => () => { gateRef.current?.cancel(); }, []);

  return {
    altScreenVisible,
    interactiveMode,
    interactiveFullscreen,
    modeState,
    // One deliberate exception to "every surface is unchanged": an inferred TUI
    // (tuiHint, from the cursor-reposition regex) resolves to 'program' and so
    // renders 'docked', where the pre-migration code faked an alt screen and
    // rendered 'fullscreen'. That is the tuiHint row of the plan's behaviour
    // table and the reason claude-ink and python-repl are pinned KNOWN-BAD in
    // the replay corpus: a redraw heuristic is not an alt screen, and docked is
    // the honest answer. Pinned by tests/unit/useTerminalMode.test.tsx.
    onModeSignal: useCallback((signal: ModeSignal) => {
      commitMode(resolverRef.current.apply(signal));
    }, [commitMode]),
    onLegacyAltScreen: useCallback((entered: boolean) => {
      setAltScreenVisible(entered);
    }, []),
    onLegacyInteractive: useCallback((entered: boolean, fullscreen?: boolean) => {
      setInteractiveMode(entered);
      setInteractiveFullscreen(entered && !!fullscreen);
    }, []),
    onTermios: useCallback((reading: TermiosReading) => {
      gateRef.current?.update(reading);
    }, []),
    onCommandEnd: useCallback(() => {
      gateRef.current?.cancel();
      setInteractiveMode(false);
    }, []),
    reset: useCallback(() => {
      gateRef.current?.cancel();
      resolverRef.current.reset();
    }, []),
  };
}
