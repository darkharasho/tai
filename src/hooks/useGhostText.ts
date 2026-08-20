import { useState, useCallback } from 'react';
import { type CommandIndex, rankPrefix } from '@/utils/commandIndex';

export function predictCommandIndexed(
  prefix: string, index: CommandIndex, now: number, cwd?: string,
): string | null {
  if (!prefix || !prefix.trim()) return null;
  const ranked = rankPrefix(index, prefix, now, cwd);
  // The ghost is drawn as the typed text plus the candidate's remainder, so a
  // candidate that only matches case-insensitively renders in the user's own
  // casing: `cd docu` + `ments/GitHub/tai/` reads as `cd documents/GitHub/tai/`,
  // which is not the path that exists. The overlay cannot re-case what is
  // already in the textarea, so only offer candidates the typed text is a
  // literal prefix of. (Tab still re-cases the line — see completePathInsensitive.)
  return ranked.find((c) => c.startsWith(prefix)) ?? null;
}

export function predictCommand(prefix: string, history: string[]): string | null {
  if (!prefix || !prefix.trim()) return null;
  const lower = prefix.toLowerCase();
  const total = history.length;
  if (total === 0) return null;

  const scores = new Map<string, number>();
  for (let i = 0; i < total; i++) {
    const cmd = history[i];
    if (!cmd.toLowerCase().startsWith(lower) || cmd.toLowerCase() === lower) continue;
    const recency = (total - i) / total;
    scores.set(cmd, (scores.get(cmd) || 0) + 1 + recency);
  }

  let best: string | null = null;
  let bestScore = 0;
  for (const [cmd, score] of scores) {
    if (score > bestScore) { bestScore = score; best = cmd; }
  }
  return best;
}

export function useGhostText(history: string[]) {
  const [prediction, setPrediction] = useState<string | null>(null);

  const updatePrediction = useCallback((prefix: string) => {
    setPrediction(predictCommand(prefix, history));
  }, [history]);

  const clearPrediction = useCallback(() => {
    setPrediction(null);
  }, []);

  return { prediction, updatePrediction, clearPrediction };
}
