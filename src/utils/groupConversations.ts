import type { DisplayItem } from '@/components/BlockList';

export type ConversationGroup =
  | { kind: 'conversation'; items: Array<Extract<DisplayItem, { type: 'ai' }>> }
  | { kind: 'passthrough'; item: DisplayItem };

export function groupConversations(items: DisplayItem[]): ConversationGroup[] {
  const groups: ConversationGroup[] = [];
  let currentAi: Array<Extract<DisplayItem, { type: 'ai' }>> | null = null;

  for (const item of items) {
    if (item.type === 'ai') {
      if (currentAi === null) {
        currentAi = [];
        groups.push({ kind: 'conversation', items: currentAi });
      }
      currentAi.push(item);
    } else {
      currentAi = null;
      groups.push({ kind: 'passthrough', item });
    }
  }

  return groups;
}
