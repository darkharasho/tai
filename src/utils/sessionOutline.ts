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
