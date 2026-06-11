import type { DisplayItem } from '@/components/BlockList';

export interface FindMatch {
  itemId: string;
}

/**
 * Case-insensitive substring search across command cards (command + output),
 * in document order. AI items are skipped — this mirrors terminal scrollback
 * search, which is about command output.
 */
export function findMatches(items: DisplayItem[], query: string): FindMatch[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const matches: FindMatch[] = [];
  for (const item of items) {
    if (item.type !== 'command') continue;
    const haystack = `${item.block.command}\n${item.block.output}`.toLowerCase();
    if (haystack.includes(q)) matches.push({ itemId: item.block.id });
  }
  return matches;
}
