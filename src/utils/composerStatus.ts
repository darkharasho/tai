// Small pure helpers behind the composer's status affordances: where a ghost
// suggestion came from, and how a branch reads once the tree is dirty.

import type { CommandIndex } from './commandIndex';

/** Which mechanism produced the ghost text currently on screen. */
export type PredictionSource = 'history' | 'next' | 'ai';

/**
 * The provenance note shown at the right of the hint row.
 *
 * Ghost text is a guess, and an unattributed guess is indistinguishable from
 * the app inventing a command. Saying where it came from — and how often you
 * have run it *in this directory* — is what makes accepting it a decision
 * rather than a leap.
 */
export function describeProvenance(
  prediction: string | null,
  source: PredictionSource | null,
  index: CommandIndex,
  cwd: string,
): string | null {
  if (!prediction || !source) return null;
  if (source === 'ai') return 'from AI';

  const stat = index.stats[prediction.trim()];
  if (!stat) return source === 'next' ? 'likely next' : null;

  // Prefer the count for THIS directory: "41× here" is the number that tells
  // you the suggestion fits where you are standing. Fall back to the global
  // count when the command has never been run here.
  const here = cwd ? (stat.cwdCounts[cwd] ?? 0) : 0;
  const lead = source === 'next' ? 'likely next' : 'from history';
  if (here > 0) return `${lead} · ${here}× here`;
  if (stat.count > 0) return `${lead} · ${stat.count}×`;
  return lead;
}

/**
 * Branch chip text. `+N` counts entries git reports as changed, so it covers
 * staged, unstaged and untracked alike — the question the chip answers is "is
 * there anything here I have not committed", not "what kind of change is it".
 */
export function formatBranchChip(branch: string | null, dirty: number): string | null {
  if (!branch) return null;
  return dirty > 0 ? `${branch} +${dirty}` : branch;
}

/** Long-form title for the branch chip, since `+2` alone is ambiguous. */
export function describeBranch(branch: string | null, dirty: number): string | undefined {
  if (!branch) return undefined;
  if (dirty <= 0) return `On ${branch} — working tree clean`;
  return `On ${branch} — ${dirty} uncommitted ${dirty === 1 ? 'change' : 'changes'}`;
}
