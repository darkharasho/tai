import type { DisplayItem } from '@/components/BlockList';

export function hasActiveAi(items: DisplayItem[]): boolean {
  return items.some(item => item.type === 'ai' && item.streaming);
}
