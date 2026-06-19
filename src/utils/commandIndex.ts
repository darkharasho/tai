// src/utils/commandIndex.ts
export interface CommandStat {
  command: string;
  count: number;
  lastTs: number;
  cwdCounts: Record<string, number>;
  lastExitCode?: number;
}
export interface CommandIndex {
  stats: Record<string, CommandStat>;
  next: Record<string, Record<string, number>>;
}
export interface IngestEntry {
  command: string;
  cwd?: string;
  exitCode?: number;
  ts: number;
  prevCommand?: string;
}

export const MAX_INDEX_COMMANDS = 2000;
export const MAX_CWD_BUCKETS = 8;
export const MAX_NEXT_BUCKETS = 8;

export function createIndex(): CommandIndex {
  return { stats: {}, next: {} };
}

function capBuckets(buckets: Record<string, number>, max: number): void {
  const keys = Object.keys(buckets);
  if (keys.length <= max) return;
  keys.sort((a, b) => buckets[b] - buckets[a]);
  for (const k of keys.slice(max)) delete buckets[k];
}

export function ingestBlock(index: CommandIndex, e: IngestEntry): void {
  const command = e.command.trim();
  if (!command) return;
  const s = index.stats[command] ?? (index.stats[command] = { command, count: 0, lastTs: 0, cwdCounts: {} });
  s.count += 1;
  if (e.ts > s.lastTs) s.lastTs = e.ts;
  if (e.exitCode !== undefined) s.lastExitCode = e.exitCode;
  if (e.cwd) {
    s.cwdCounts[e.cwd] = (s.cwdCounts[e.cwd] ?? 0) + 1;
    capBuckets(s.cwdCounts, MAX_CWD_BUCKETS);
  }
  const prev = e.prevCommand?.trim();
  if (prev) {
    const bucket = index.next[prev] ?? (index.next[prev] = {});
    bucket[command] = (bucket[command] ?? 0) + 1;
    capBuckets(bucket, MAX_NEXT_BUCKETS);
  }
}

export function ingestHistoryLines(index: CommandIndex, lines: string[], ts: number): void {
  for (const line of lines) {
    const command = line.trim();
    if (!command) continue;
    const s = index.stats[command] ?? (index.stats[command] = { command, count: 0, lastTs: 0, cwdCounts: {} });
    s.count += 1;
    if (ts > s.lastTs) s.lastTs = ts;
  }
}

export function capIndex(index: CommandIndex, now: number): void {
  const keys = Object.keys(index.stats);
  if (keys.length <= MAX_INDEX_COMMANDS) return;
  // Evict lowest frecency (count + recency proxy). Cheap proxy here; full
  // frecency lives in Task 2 but cap only needs a stable ordering.
  keys.sort((a, b) => {
    const sa = index.stats[a], sb = index.stats[b];
    return (sb.count + sb.lastTs / now) - (sa.count + sa.lastTs / now);
  });
  for (const k of keys.slice(MAX_INDEX_COMMANDS)) {
    delete index.stats[k];
    delete index.next[k];
  }
}

export const W_FREQ = 1;
export const W_RECENT = 2;
export const W_CWD = 1.5;
export const HALF_LIFE_MS = 1000 * 60 * 60 * 24 * 7;

export function frecency(stat: CommandStat, now: number, cwd?: string): number {
  const ageMs = Math.max(0, now - stat.lastTs);
  const recency = Math.pow(0.5, ageMs / HALF_LIFE_MS); // 1 → 0 over half-lives
  const cwdHits = cwd ? (stat.cwdCounts[cwd] ?? 0) : 0;
  return (
    W_FREQ * Math.log(stat.count + 1) +
    W_RECENT * recency +
    W_CWD * (cwdHits > 0 ? Math.log(cwdHits + 1) : 0)
  );
}

export function rankPrefix(index: CommandIndex, prefix: string, now: number, cwd?: string): string[] {
  const lower = prefix.toLowerCase();
  if (!lower.trim()) return [];
  const matches: { command: string; score: number }[] = [];
  for (const command in index.stats) {
    const cl = command.toLowerCase();
    if (cl === lower || !cl.startsWith(lower)) continue;
    matches.push({ command, score: frecency(index.stats[command], now, cwd) });
  }
  matches.sort((a, b) => b.score - a.score);
  return matches.map((m) => m.command);
}

export function topNext(index: CommandIndex, prevCommand: string, n: number): string[] {
  const bucket = index.next[prevCommand.trim()];
  if (!bucket) return [];
  return Object.keys(bucket).sort((a, b) => bucket[b] - bucket[a]).slice(0, n);
}

/**
 * Returns true if a finalized block should be ingested into the local command
 * index.  Remote blocks are excluded because their cwd is a remote path and
 * will never match local predictor cwd, polluting suggestions.  Empty commands
 * are excluded because there is nothing useful to index.
 *
 * Note: AI-suggested commands that the user actually ran are NOT filtered —
 * they are valid local history regardless of how they were composed.
 */
export function shouldIndexBlock(block: { isRemote?: boolean; command: string }): boolean {
  if (block.isRemote) return false;
  if (!block.command.trim()) return false;
  return true;
}
