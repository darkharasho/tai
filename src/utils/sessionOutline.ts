import type { DisplayItem } from '@/components/BlockList';
import { classifyExit, type ExitClass } from './exitStatus';

/** What a row contributes to the sidebar's spine. `neutral` covers Ctrl-C,
    SIGPIPE and blocks whose exit we never learned — real enough to list,
    not wrong enough to shout about. */
export type OutlineKind = 'ok' | 'fail' | 'neutral' | 'ai' | 'run';

export interface OutlineEntry {
  id: string;
  label: string;
  kind: OutlineKind;
  durationMs?: number;
}

export interface SessionOutline {
  /** Oldest first, matching document order in the block list. */
  entries: OutlineEntry[];
  total: number;
  failed: number;
}

export const EMPTY_OUTLINE: SessionOutline = { entries: [], total: 0, failed: 0 };

const EXIT_KIND: Record<ExitClass, OutlineKind> = {
  success: 'ok',
  failure: 'fail',
  neutral: 'neutral',
  unknown: 'neutral',
};

/** A sidebar row is one line high, so newlines and runs of whitespace in a
    heredoc or a multi-line prompt have to collapse before they get there. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function buildOutline(items: DisplayItem[]): SessionOutline {
  const entries: OutlineEntry[] = [];
  for (const item of items) {
    if (item.type === 'command') {
      const label = oneLine(item.block.command);
      // A bare Enter makes a block with no command; it has nothing to index.
      if (!label) continue;
      entries.push({
        id: item.block.id,
        label,
        kind: item.active ? 'run' : EXIT_KIND[classifyExit(item.block.exitCode, item.block.signal)],
        durationMs: item.block.duration,
      });
    } else if (item.type === 'ai') {
      entries.push({
        id: item.id,
        label: oneLine(item.question) || 'AI',
        kind: item.streaming ? 'run' : 'ai',
        durationMs: item.duration,
      });
    }
    // Approval cards are a step inside an AI answer, not a block of their own.
  }
  return {
    entries,
    total: entries.length,
    failed: entries.reduce((n, e) => n + (e.kind === 'fail' ? 1 : 0), 0),
  };
}

/** Sub-second timings are noise on every `ls`; the sidebar's number column is
    narrow enough that it should stay empty unless it is saying something. */
export function formatOutlineDuration(ms: number | undefined): string | null {
  if (ms == null || ms < 1000) return null;
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
  return `${Math.round(ms / 3600000)}h`;
}

/** How many buckets the tab row's sparkline has room for at a 3.5px pitch,
    once the cwd leaf and the failure count have taken their share. */
export const SPARK_BUCKETS = 28;

/** Loudest first: a bucket is painted by the worst thing that happened in it,
    so compressing a session can hide a success but never hides a failure. */
const KIND_RANK: Record<OutlineKind, number> = {
  fail: 4,
  run: 3,
  ai: 2,
  neutral: 1,
  ok: 0,
};

/**
 * Compress an outline to at most `buckets` marks for the sparkline.
 *
 * Sessions run to thousands of blocks and the row is 100px wide, so the marks
 * cannot be one-per-block. Even-width buckets keep the horizontal axis linear
 * — a failure a third of the way along the strip really is a third of the way
 * through the session — and each bucket reports its worst kind, which is what
 * makes the strip readable as session health rather than as a texture.
 */
export function bucketOutline(entries: OutlineEntry[], buckets = SPARK_BUCKETS): OutlineKind[] {
  if (buckets < 1 || entries.length === 0) return [];
  // Fewer blocks than slots: one mark each, so a short session reads as a
  // short strip instead of being stretched to full width.
  if (entries.length <= buckets) return entries.map(entry => entry.kind);

  const marks: OutlineKind[] = [];
  for (let i = 0; i < buckets; i++) {
    const start = Math.floor((i * entries.length) / buckets);
    const end = Math.floor(((i + 1) * entries.length) / buckets);
    let worst: OutlineKind = entries[start].kind;
    for (let j = start + 1; j < end; j++) {
      if (KIND_RANK[entries[j].kind] > KIND_RANK[worst]) worst = entries[j].kind;
    }
    marks.push(worst);
  }
  return marks;
}
