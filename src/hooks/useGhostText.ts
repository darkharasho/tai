import { useState, useCallback } from 'react';

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
