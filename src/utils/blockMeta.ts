import type { DisplayItem } from '@/components/BlockList';
import type { SegmentedBlock } from '@/types';

/**
 * Immutably patch one command block in a display-item list. Untouched items
 * keep their references so memoized cards don't re-render. Returns the input
 * array unchanged when the block isn't present (e.g. it was cleared).
 */
export function patchBlock(
  items: DisplayItem[],
  blockId: string,
  patch: Partial<SegmentedBlock>,
): DisplayItem[] {
  const idx = items.findIndex(i => i.type === 'command' && i.block.id === blockId);
  if (idx === -1) return items;
  const item = items[idx] as DisplayItem & { type: 'command' };
  const next = [...items];
  next[idx] = { ...item, block: { ...item.block, ...patch } };
  return next;
}
