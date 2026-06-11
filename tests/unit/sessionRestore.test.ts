// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { persistBlocks, loadBlocks, MAX_PERSISTED_BLOCKS, MAX_PERSISTED_LINES } from '@/utils/sessionRestore';
import type { DisplayItem } from '@/components/BlockList';
import type { SegmentedBlock } from '@/types';

function cmd(id: string, extra: Partial<SegmentedBlock> = {}, item: Partial<DisplayItem & { type: 'command' }> = {}): DisplayItem {
  return {
    type: 'command',
    block: {
      id,
      command: `cmd-${id}`,
      output: 'out',
      rawOutput: 'out',
      promptText: 'me@host ~ $',
      startTime: 1,
      duration: 5,
      exitCode: 0,
      isRemote: false,
      ...extra,
    } as SegmentedBlock,
    ...item,
  } as DisplayItem;
}

beforeEach(() => localStorage.clear());

describe('session restore', () => {
  it('round-trips finished command blocks', () => {
    persistBlocks('tab-1', [cmd('a'), cmd('b', { exitCode: 1, gitBranch: 'main', cwd: '/x' })]);
    const blocks = loadBlocks('tab-1');
    expect(blocks.map(b => b.id)).toEqual(['a', 'b']);
    expect(blocks[1].exitCode).toBe(1);
    expect(blocks[1].gitBranch).toBe('main');
    expect(blocks[1].cwd).toBe('/x');
  });

  it('skips active and pending blocks and ai items', () => {
    const ai: DisplayItem = { type: 'ai', id: 'x', question: 'q', content: 'c', suggestedCommands: [], streaming: false };
    persistBlocks('tab-1', [cmd('a'), cmd('pending'), cmd('b', {}, { active: true }), ai]);
    expect(loadBlocks('tab-1').map(b => b.id)).toEqual(['a']);
  });

  it('keeps only the most recent MAX_PERSISTED_BLOCKS blocks', () => {
    const items = Array.from({ length: MAX_PERSISTED_BLOCKS + 10 }, (_, i) => cmd(`b${i}`));
    persistBlocks('tab-1', items);
    const blocks = loadBlocks('tab-1');
    expect(blocks).toHaveLength(MAX_PERSISTED_BLOCKS);
    expect(blocks[blocks.length - 1].id).toBe(`b${MAX_PERSISTED_BLOCKS + 9}`);
  });

  it('caps persisted output to the serialization line limit (tail)', () => {
    const big = Array.from({ length: MAX_PERSISTED_LINES + 50 }, (_, i) => `line${i + 1}`).join('\n');
    persistBlocks('tab-1', [cmd('a', { output: big, rawOutput: big })]);
    const [block] = loadBlocks('tab-1');
    const lines = block.output.split('\n');
    expect(lines).toHaveLength(MAX_PERSISTED_LINES);
    expect(lines[lines.length - 1]).toBe(`line${MAX_PERSISTED_LINES + 50}`);
  });

  it('is namespaced per tab', () => {
    persistBlocks('tab-1', [cmd('a')]);
    expect(loadBlocks('tab-2')).toEqual([]);
  });

  it('returns [] for corrupt or missing payloads', () => {
    localStorage.setItem('tai:session:tab-9', '{not json');
    expect(loadBlocks('tab-9')).toEqual([]);
    expect(loadBlocks('tab-none')).toEqual([]);
  });
});
