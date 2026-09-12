export type AskpassDecision = 'refuse' | 'auto-fill' | 'reject' | 'prompt';

/**
 * What to do with an askpass request. Mirrors decideAutoFill in sudoAutoFill.ts,
 * keyed on the verified sudo pid instead of the terminal's foreground group:
 * the same sudo process asking again means the secret we replayed was wrong,
 * and replaying it a third time would trip pam_faillock.
 */
export function decideAskpass(input: {
  sudoPid: number | null;
  vaultSet: boolean;
  lastFilledSudoPid: number | null;
}): AskpassDecision {
  const { sudoPid, vaultSet, lastFilledSudoPid } = input;
  if (sudoPid === null) return 'refuse';
  if (!vaultSet) return 'prompt';
  if (lastFilledSudoPid !== null && sudoPid === lastFilledSudoPid) return 'reject';
  return 'auto-fill';
}
