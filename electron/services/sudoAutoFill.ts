import type { Foreground } from './foregroundProcess';

export type AutoFillDecision = 'auto-fill' | 'reject' | 'prompt';

/**
 * Decide what to do on a detected password prompt. Only ever auto-fills a real
 * `sudo` foreground; everything else falls back to the widget.
 *
 * Rejection is keyed on the sudo process identity (`tpgid`), not a time window:
 * if the SAME sudo process that we just auto-filled is prompting again, our
 * cached secret was wrong → reject. A DIFFERENT sudo process (e.g. the second
 * command in `sudo a; sudo b`) is a fresh prompt → auto-fill again.
 */
export function decideAutoFill(input: {
  foreground: Foreground;
  vaultSet: boolean;
  /** tpgid of the sudo process currently prompting (null if unresolved). */
  tpgid: number | null;
  /** tpgid of the sudo process we most recently auto-filled on this PTY. */
  lastFilledTpgid: number | null;
}): AutoFillDecision {
  const { foreground, vaultSet, tpgid, lastFilledTpgid } = input;
  if (foreground !== 'sudo' || !vaultSet) return 'prompt';
  if (tpgid !== null && lastFilledTpgid !== null && tpgid === lastFilledTpgid) {
    return 'reject';
  }
  return 'auto-fill';
}
