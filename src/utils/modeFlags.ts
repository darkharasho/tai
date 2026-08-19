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
