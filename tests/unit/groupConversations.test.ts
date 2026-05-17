import { describe, it, expect } from 'vitest';
import { groupConversations, type ConversationGroup } from '@/utils/groupConversations';
import type { DisplayItem } from '@/components/BlockList';

function ai(id: string): DisplayItem {
  return { type: 'ai', id, question: 'q', content: '', suggestedCommands: [], streaming: false };
}

function cmd(id: string): DisplayItem {
  // Minimal shape — groupConversations only inspects `type`.
  return { type: 'command', block: { id } as any };
}

function approval(id: string): DisplayItem {
  return { type: 'approval', id, command: 'rm', toolUseId: 't', toolName: 'Bash', status: 'pending' };
}

describe('groupConversations', () => {
  it('returns an empty array for no items', () => {
    expect(groupConversations([])).toEqual([]);
  });

  it('wraps a single AI item in a conversation group of size 1', () => {
    const items = [ai('a1')];
    const groups: ConversationGroup[] = groupConversations(items);
    expect(groups).toHaveLength(1);
    expect(groups[0].kind).toBe('conversation');
    if (groups[0].kind === 'conversation') {
      expect(groups[0].items).toHaveLength(1);
      expect(groups[0].items[0].id).toBe('a1');
    }
  });

  it('groups consecutive AI items into one conversation', () => {
    const items = [ai('a1'), ai('a2'), ai('a3')];
    const groups = groupConversations(items);
    expect(groups).toHaveLength(1);
    expect(groups[0].kind).toBe('conversation');
    if (groups[0].kind === 'conversation') {
      expect(groups[0].items.map(i => i.id)).toEqual(['a1', 'a2', 'a3']);
    }
  });

  it('breaks a conversation when a non-AI item appears between AI items', () => {
    const items = [ai('a1'), cmd('c1'), ai('a2')];
    const groups = groupConversations(items);
    expect(groups).toHaveLength(3);
    expect(groups[0].kind).toBe('conversation');
    expect(groups[1].kind).toBe('passthrough');
    expect(groups[2].kind).toBe('conversation');
  });

  it('treats approval items as conversation breakers', () => {
    const items = [ai('a1'), approval('p1'), ai('a2')];
    const groups = groupConversations(items);
    expect(groups.map(g => g.kind)).toEqual(['conversation', 'passthrough', 'conversation']);
  });

  it('handles a mixed sequence end-to-end', () => {
    // cmd, ai, ai, cmd, ai, approval, ai, ai
    const items = [
      cmd('c1'),
      ai('a1'), ai('a2'),
      cmd('c2'),
      ai('a3'),
      approval('p1'),
      ai('a4'), ai('a5'),
    ];
    const groups = groupConversations(items);
    expect(groups.map(g => g.kind)).toEqual([
      'passthrough',
      'conversation',
      'passthrough',
      'conversation',
      'passthrough',
      'conversation',
    ]);
    const sizes = groups.map(g => g.kind === 'conversation' ? g.items.length : 1);
    expect(sizes).toEqual([1, 2, 1, 1, 1, 2]);
  });
});
