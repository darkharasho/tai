// src/utils/palette.ts
export type PaletteSource = 'history' | 'workflow' | 'command';
export interface PaletteItem {
  id: string; label: string; value: string; source: PaletteSource; description?: string;
}

// Subsequence fuzzy score: lower is better (gaps penalized); null = no match.
function fuzzyScore(query: string, text: string): number | null {
  const q = query.toLowerCase(), t = text.toLowerCase();
  let qi = 0, score = 0, lastIdx = -1;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      if (lastIdx >= 0) score += ti - lastIdx - 1; // gap penalty
      lastIdx = ti; qi++;
    }
  }
  return qi === q.length ? score + t.length * 0.001 : null;
}

export function rankPaletteItems(query: string, items: PaletteItem[]): PaletteItem[] {
  if (!query.trim()) return items;
  const scored: { item: PaletteItem; score: number }[] = [];
  for (const item of items) {
    const s = fuzzyScore(query, item.label);
    if (s !== null) scored.push({ item, score: s });
  }
  scored.sort((a, b) => a.score - b.score);
  return scored.map((s) => s.item);
}
