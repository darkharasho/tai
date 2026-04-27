import type { DisplayItem } from '@/types';

export function hasActiveAi(items: DisplayItem[]): boolean {
  return items.some(item => item.type === 'ai' && item.streaming);
}
