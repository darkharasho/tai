import { describe, it, expect } from 'vitest';
import { patchBlock } from '@/utils/blockMeta';
import type { DisplayItem } from '@/components/BlockList';
import type { SegmentedBlock } from '@/types';

function cmd(id: string): DisplayItem {
  return { type: 'command', block: { id, command: 'x', output: '', rawOutput: '', promptText: '', startTime: 0, duration: 0, isRemote: false } as SegmentedBlock };
}

describe('patchBlock', () => {
  it('patches the matching block immutably and keeps other items by reference', () => {
    const items = [cmd('a'), cmd('b')];
    const next = patchBlock(items, 'b', { gitBranch: 'main' });
    expect(next).not.toBe(items);
    expect(next[0]).toBe(items[0]);
    expect((next[1] as DisplayItem & { type: 'command' }).block.gitBranch).toBe('main');
    expect((items[1] as DisplayItem & { type: 'command' }).block.gitBranch).toBeUndefined();
  });

  it('returns the same array when the block is not found', () => {
    const items = [cmd('a')];
    expect(patchBlock(items, 'zzz', { gitBranch: 'main' })).toBe(items);
  });

  it('ignores non-command items', () => {
    const ai: DisplayItem = { type: 'ai', id: 'x', question: 'q', content: '', suggestedCommands: [], streaming: false };
    const items = [ai, cmd('a')];
    const next = patchBlock(items, 'a', { gitBranch: 'dev' });
    expect(next[0]).toBe(ai);
  });
});
