/**
 * Assemble the composer's up-arrow history. Entries must be retypeable
 * one-liners: blanks (STOP/^C and stdin writes produce empty-command
 * blocks) and multi-line framed AI prompts are dropped, and consecutive
 * duplicates collapse like bash's HISTCONTROL=ignoredups.
 */
export function assembleInputHistory(base: string[], session: string[]): string[] {
  const out: string[] = [];
  for (const entry of [...base, ...session]) {
    if (!entry || !entry.trim()) continue;
    if (entry.includes('\n')) continue;
    if (out[out.length - 1] === entry) continue;
    out.push(entry);
  }
  return out;
}
