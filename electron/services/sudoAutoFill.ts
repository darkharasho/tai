import type { Foreground } from './foregroundProcess';

/** A sudo re-prompt within this window after an auto-fill means the cached
 *  secret was wrong — invalidate it instead of replaying it again. */
export const REJECT_WINDOW_MS = 2000;

export type AutoFillDecision = 'auto-fill' | 'reject' | 'prompt';

/**
 * Decide what to do on a detected password prompt. Only ever auto-fills a real
 * `sudo` foreground; everything else falls back to the widget.
 */
export function decideAutoFill(input: {
  foreground: Foreground;
  vaultSet: boolean;
  msSinceLastAutoFill: number | null;
}): AutoFillDecision {
  const { foreground, vaultSet, msSinceLastAutoFill } = input;
  if (foreground !== 'sudo' || !vaultSet) return 'prompt';
  if (msSinceLastAutoFill !== null && msSinceLastAutoFill <= REJECT_WINDOW_MS) {
    return 'reject';
  }
  return 'auto-fill';
}
