import type { DisplayItem } from '@/components/BlockList';
import type { SegmentedBlock } from '@/types';
import { tailLines } from '@/utils/outputWindow';

// Warp persists the last 100 blocks per session with a 5000-styled-line
// serialization cap; we keep a tighter budget since this lives in
// localStorage rather than SQLite.
export const MAX_PERSISTED_BLOCKS = 50;
export const MAX_PERSISTED_LINES = 200;

const VERSION = 1;
const keyFor = (tabId: string) => `tai:session:${tabId}`;

interface Payload {
  v: number;
  savedAt: number;
  blocks: SegmentedBlock[];
}

/**
 * Persist the finished command blocks of a tab. Active/pending blocks and AI
 * items are skipped — only completed shell history survives a restart.
 */
export function persistBlocks(tabId: string, items: DisplayItem[]): void {
  const blocks = items
    .filter((i): i is DisplayItem & { type: 'command' } =>
      i.type === 'command' && !i.active && i.block.id !== 'pending')
    .slice(-MAX_PERSISTED_BLOCKS)
    .map(({ block }) => ({
      ...block,
      output: tailLines(block.output, MAX_PERSISTED_LINES).text,
      rawOutput: tailLines(block.rawOutput, MAX_PERSISTED_LINES).text,
    }));
  const payload: Payload = { v: VERSION, savedAt: Date.now(), blocks };
  try {
    localStorage.setItem(keyFor(tabId), JSON.stringify(payload));
  } catch {
    // Quota or serialization failure — session restore is best-effort.
  }
}

export function loadBlocks(tabId: string): SegmentedBlock[] {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(keyFor(tabId));
  } catch {
    return [];
  }
  if (!raw) return [];
  try {
    const payload = JSON.parse(raw) as Payload;
    if (payload?.v !== VERSION || !Array.isArray(payload.blocks)) return [];
    return payload.blocks.filter(
      (b): b is SegmentedBlock =>
        !!b && typeof b.id === 'string' && typeof b.command === 'string' && typeof b.output === 'string',
    );
  } catch {
    return [];
  }
}
