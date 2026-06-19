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
