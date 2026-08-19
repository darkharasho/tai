import type { ModeState } from '@/utils/terminalMode';

/**
 * Whether two ModeStates say the same thing.
 *
 * The resolver returns a fresh object for every applied signal, including the
 * ones that change nothing (a cooked termios reading while a fullscreen program
 * owns the input is a no-op by rule 3). Treating those as transitions would
 * re-run the derive effect and overwrite flags the legacy callbacks had just
 * set — a decision change, from a reading that carried no news.
 */
export function sameModeState(a: ModeState, b: ModeState): boolean {
  return a.inputOwner === b.inputOwner
    && a.provenance === b.provenance
    && a.degradedReason === b.degradedReason
    && a.passwordPrompt === b.passwordPrompt
    && a.commandRunning === b.commandRunning;
}

/**
 * The projection from the resolver's one state to the three interactivity
 * signals `deriveInputSurface` reads.
 *
 * This is a pure function of ModeState rather than three fields inlined at the
 * call site, and that is load-bearing. `deriveInputSurface` reaches 'fullscreen'
 * either through `altScreenVisible` or through `interactiveMode &&
 * interactiveFullscreen`, and 'docked' through `interactiveMode` alone — three
 * booleans with a non-obvious precedence. Inlined into a component with no test
 * file, all three could be replaced by `false` (stranding every TUI, REPL and
 * alt-screen program on the composer with no xterm) without a single test
 * noticing. Here it is unit-testable, and — critically — the tests call the
 * same function the component does instead of re-implementing it, which is the
 * exact drift this migration keeps paying for.
 *
 * There is still one state. This is a view of it, not a second copy.
 */
export function inputSignalsFromMode(mode: ModeState): {
  altScreenVisible: boolean;
  interactiveMode: boolean;
  interactiveFullscreen: boolean;
  degraded: boolean;
} {
  const fullscreen = mode.inputOwner === 'fullscreen';
  return {
    altScreenVisible: fullscreen,
    interactiveMode: fullscreen || mode.inputOwner === 'program',
    interactiveFullscreen: fullscreen,
    // Task 10. Lives here rather than inline at the call site for the same
    // reason as the three above: it is a projection of ModeState onto the
    // surface's inputs, and inline in a component with no test file it could be
    // replaced by `false` — stranding every Windows user on the composer with
    // no way to type — with tsc clean and the whole suite green. It was, and
    // the mutation went unnoticed until this moved.
    degraded: mode.provenance === 'degraded',
  };
}
