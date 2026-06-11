import { describe, it, expect } from 'vitest';
import { findMatches } from '@/utils/blockFind';
import type { DisplayItem } from '@/components/BlockList';
import type { SegmentedBlock } from '@/types';

function cmd(id: string, command: string, output = ''): DisplayItem {
  return { type: 'command', block: { id, command, output, rawOutput: output, promptText: '', startTime: 0, duration: 0, isRemote: false } as SegmentedBlock };
}

const items: DisplayItem[] = [
  cmd('a', 'ls -la', 'alpha'),
  cmd('b', 'grep ERROR app.log', 'beta gamma'),
  { type: 'ai', id: 'x', question: 'why ERROR?', content: 'because', suggestedCommands: [], streaming: false },
  cmd('c', 'echo done', 'gamma'),
];

describe('findMatches', () => {
  it('matches on command text', () => {
    expect(findMatches(items, 'grep').map(m => m.itemId)).toEqual(['b']);
  });

  it('matches on output text', () => {
    expect(findMatches(items, 'alpha').map(m => m.itemId)).toEqual(['a']);
  });

  it('is case-insensitive', () => {
    expect(findMatches(items, 'error').map(m => m.itemId)).toEqual(['b']);
  });

  it('returns matches in document order, ignoring ai items', () => {
    expect(findMatches(items, 'gamma').map(m => m.itemId)).toEqual(['b', 'c']);
  });

  it('returns nothing for an empty or whitespace query', () => {
    expect(findMatches(items, '')).toEqual([]);
    expect(findMatches(items, '  ')).toEqual([]);
  });
});
