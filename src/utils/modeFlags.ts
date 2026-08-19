import type { ModeState } from '@/utils/terminalMode';

/**
 * The bridge from the resolver's model back to the three legacy React flags,
 * kept behaviour-neutral on purpose.
 *
 * `deriveInputSurface` reads 'fullscreen' as
 * `altScreenVisible || (interactiveMode && interactiveFullscreen)` and 'docked'
 * as `interactiveMode`, so this mapping reproduces both branches. The flags
 * collapse into ModeState in the next commit.
 */
export function legacyFlagsFromMode(mode: ModeState): {
  altScreenVisible: boolean;
  interactiveMode: boolean;
  interactiveFullscreen: boolean;
} {
  const fullscreen = mode.inputOwner === 'fullscreen';
  return {
    altScreenVisible: fullscreen,
    interactiveMode: fullscreen || mode.inputOwner === 'program',
    interactiveFullscreen: fullscreen,
  };
}

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
