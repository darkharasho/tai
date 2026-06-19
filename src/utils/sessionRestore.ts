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
 *
 * On QuotaExceededError the function sheds the oldest half of blocks and
 * retries, halving on each failure until only one block remains. If even one
 * block exceeds quota (or a non-quota error is thrown) the save is skipped
 * best-effort. One console.warn is emitted per shed cycle.
 */
export function persistBlocks(tabId: string, items: DisplayItem[]): void {
  const all = items
    .filter((i): i is DisplayItem & { type: 'command' } =>
      i.type === 'command' && !i.active && i.block.id !== 'pending')
    .slice(-MAX_PERSISTED_BLOCKS)
    .map(({ block }) => ({
      ...block,
      output: tailLines(block.output, MAX_PERSISTED_LINES).text,
      rawOutput: tailLines(block.rawOutput, MAX_PERSISTED_LINES).text,
    }));

  for (let blocks = all; ; blocks = blocks.slice(Math.ceil(blocks.length / 2))) {
    const payload: Payload = { v: VERSION, savedAt: Date.now(), blocks };
    try {
      localStorage.setItem(keyFor(tabId), JSON.stringify(payload));
      return;
    } catch (e) {
      if (blocks.length > 1 && (e as any)?.name === 'QuotaExceededError') {
        console.warn(`[sessionRestore] quota exceeded for ${tabId}; shedding to ${Math.ceil(blocks.length / 2)} blocks`);
        continue;
      }
      return; // non-quota error or down to 1 block — best-effort, give up
    }
  }
}

// Blocks persisted by older builds can carry segmentation garbage: prompt
// echoes recorded as commands, raw control bytes, empty noise blocks. Scrub
// once at load so old localStorage doesn't keep haunting the scrollback.
const CONTROL_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;
const PROMPT_ECHO_BLOCK_RE = /^(?:[^\n]*[❯➜✘»⟫]|\S+@\S+[:\s]\s*\S*\s*[$#%]\s*$)/;

function scrubBlock(b: SegmentedBlock): SegmentedBlock | null {
  const command = b.command.replace(CONTROL_RE, '');
  const output = b.output.replace(CONTROL_RE, '');
  // rawOutput must keep ESC (\x1b) for its SGR color runs.
  const rawOutput = (b.rawOutput ?? '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1a\x1c-\x1f\x7f]/g, '');
  if (!command.trim() && !output.trim()) return null;
  if (PROMPT_ECHO_BLOCK_RE.test(command.split('\n')[0] ?? '')) return null;
  if (command === b.command && output === b.output && rawOutput === b.rawOutput) return b;
  return { ...b, command, output, rawOutput };
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
    return payload.blocks
      .filter(
        (b): b is SegmentedBlock =>
          !!b && typeof b.id === 'string' && typeof b.command === 'string' && typeof b.output === 'string',
      )
      .map(scrubBlock)
      .filter((b): b is SegmentedBlock => b !== null);
  } catch {
    return [];
  }
}
