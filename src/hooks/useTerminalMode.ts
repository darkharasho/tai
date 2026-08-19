import { useState, useRef, useCallback, useEffect } from 'react';
import { createModeResolver, type ModeSignal, type ModeState } from '@/utils/terminalMode';
import { sameModeState } from '@/utils/modeFlags';

/** A termios reading from the kernel-side echo poller. */
export interface TermiosReading {
  icanon: boolean;
  echo: boolean;
}

/**
 * All of the terminal's mode wiring, in one testable place.
 *
 * TerminalSession forwards events here and reads `modeState` back; it holds no
 * mode logic of its own. That is deliberate: a test that re-implements the
 * wiring can drift from the component silently while still reading as coverage,
 * so the component and the tests have to call the same code.
 *
 * There is exactly one piece of state. The three React flags this replaced
 * (altScreenVisible / interactiveMode / interactiveFullscreen) were three
 * deciders with three latencies and an ad-hoc precedence; the resolver settles
 * that by tier instead. In particular there is no debounce on the termios
 * reading any more — it was there to paper over the same race, and delaying the
 * authoritative signal only delayed the correction of a bad guess. A transient
 * ICANON drop (brew's progress bar) now moves the surface and is corrected by
 * the restore, which is honest and, from Task 9, free of output loss.
 */
export interface TerminalModeApi {
  modeState: ModeState;
  /** BlockSegmenter.onModeSignal */
  onModeSignal: (signal: ModeSignal) => void;
  /** A termios reading from the echo poller. */
  onTermios: (reading: TermiosReading) => void;
  /** The block finished, so no raw-mode program can still be foreground. */
  onCommandEnd: () => void;
  reset: () => void;
}

/**
 * @param onResolved Sink for every resolved state, called synchronously with
 *   the resolver's answer. BlockSegmenter needs the state on the same tick as
 *   the bytes that produced it — React state lands a tick later, and a
 *   retention decision made against a stale mode is the race this migration
 *   exists to remove. It hangs off the hook rather than off each call site so
 *   that no future signal can update one decider and not the other.
 */
export function useTerminalMode(onResolved?: (state: ModeState) => void): TerminalModeApi {
  const resolverRef = useRef(createModeResolver());
  const [modeState, setModeState] = useState<ModeState>(() => resolverRef.current.state);
  const sinkRef = useRef(onResolved);
  useEffect(() => { sinkRef.current = onResolved; });

  // The resolver returns a fresh object for every signal, including ones that
  // change nothing — committing those would re-render on every 200ms echo poll
  // for no news.
  const commit = useCallback((next: ModeState) => {
    // Unconditionally, including for news-free readings: the dedupe below is a
    // render optimisation, and a consumer that skipped one would be reasoning
    // about a state the resolver has already moved past.
    sinkRef.current?.(next);
    setModeState(prev => (sameModeState(prev, next) ? prev : next));
  }, []);

  return {
    modeState,
    // An inferred TUI (tuiHint, from the cursor-reposition regex) resolves to
    // 'program' and so renders 'docked', where the pre-migration code faked an
    // alt screen and rendered 'fullscreen'. That is the tuiHint row of the
    // plan's behaviour table and the reason claude-ink and python-repl were
    // pinned KNOWN-BAD in the replay corpus: a redraw heuristic is not an alt
    // screen, and docked is the honest answer.
    onModeSignal: useCallback((signal: ModeSignal) => {
      commit(resolverRef.current.apply(signal));
    }, [commit]),
    onTermios: useCallback((reading: TermiosReading) => {
      commit(resolverRef.current.apply({
        kind: 'termios', icanon: reading.icanon, echo: reading.echo,
      }));
    }, [commit]),
    onCommandEnd: useCallback(() => {
      // A finished block is a command boundary: the foreground is the shell
      // again. Same semantics as the prompt marker, so it reuses that signal
      // rather than inventing a parallel reset path.
      commit(resolverRef.current.apply({ kind: 'osc133', phase: 'prompt' }));
    }, [commit]),
    reset: useCallback(() => {
      resolverRef.current.reset();
      commit(resolverRef.current.state);
    }, [commit]),
  };
}
