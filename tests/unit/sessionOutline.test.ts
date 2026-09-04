import { describe, it, expect } from 'vitest';
import { bucketOutline, buildOutline, formatOutlineDuration } from '@/utils/sessionOutline';
import type { OutlineEntry, OutlineKind } from '@/utils/sessionOutline';
import type { DisplayItem } from '@/components/BlockList';
import type { SegmentedBlock } from '@/types';

function cmd(
  id: string,
  command: string,
  extra: Partial<SegmentedBlock> = {},
  item: Partial<DisplayItem & { type: 'command' }> = {},
): DisplayItem {
  return {
    type: 'command',
    block: {
      id, command, output: '', rawOutput: '', promptText: '',
      startTime: 0, duration: 0, isRemote: false, ...extra,
    } as SegmentedBlock,
    ...item,
  };
}

describe('buildOutline', () => {
  it('classifies exit codes into tick kinds', () => {
    const outline = buildOutline([
      cmd('a', 'ls', { exitCode: 0 }),
      cmd('b', 'grep nope f', { exitCode: 1 }),
      cmd('c', 'sleep 9', { exitCode: 130 }),
      cmd('d', 'still-running'),
    ]);
    expect(outline.entries.map(e => e.kind)).toEqual(['ok', 'fail', 'neutral', 'neutral']);
    expect(outline.total).toBe(4);
    expect(outline.failed).toBe(1);
  });

  it('marks the active block as running regardless of exit code', () => {
    const outline = buildOutline([cmd('a', 'npm run dev', { exitCode: 1 }, { active: true })]);
    expect(outline.entries[0].kind).toBe('run');
    expect(outline.failed).toBe(0);
  });

  it('treats a signalled block as neutral, not a failure', () => {
    const outline = buildOutline([cmd('a', 'tail -f log', { exitCode: 143, signal: 'SIG15' })]);
    expect(outline.entries[0].kind).toBe('neutral');
  });

  it('collapses multi-line commands to one line', () => {
    const outline = buildOutline([cmd('a', 'cat <<EOF\n  hello\n\nEOF')]);
    expect(outline.entries[0].label).toBe('cat <<EOF hello EOF');
  });

  it('skips blocks with no command', () => {
    expect(buildOutline([cmd('a', '   ')]).entries).toEqual([]);
  });

  it('carries AI questions as their own kind, streaming ones as running', () => {
    const outline = buildOutline([
      { type: 'ai', id: 'x', question: 'why did that fail?', content: '', suggestedCommands: [], streaming: false, duration: 4200 },
      { type: 'ai', id: 'y', question: 'and now?', content: '', suggestedCommands: [], streaming: true },
    ]);
    expect(outline.entries).toEqual([
      { id: 'x', label: 'why did that fail?', kind: 'ai', durationMs: 4200 },
      { id: 'y', label: 'and now?', kind: 'run', durationMs: undefined },
    ]);
  });

  it('ignores approval cards, which belong to an AI answer', () => {
    const outline = buildOutline([
      { type: 'approval', id: 'p', command: 'rm -rf /', toolUseId: 't', toolName: 'Bash', status: 'pending' },
    ]);
    expect(outline.total).toBe(0);
  });

  it('preserves document order', () => {
    const outline = buildOutline([cmd('a', 'first'), cmd('b', 'second'), cmd('c', 'third')]);
    expect(outline.entries.map(e => e.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('formatOutlineDuration', () => {
  it('hides sub-second timings', () => {
    expect(formatOutlineDuration(0)).toBeNull();
    expect(formatOutlineDuration(999)).toBeNull();
    expect(formatOutlineDuration(undefined)).toBeNull();
  });

  it('scales the unit to the magnitude', () => {
    expect(formatOutlineDuration(1000)).toBe('1s');
    expect(formatOutlineDuration(12400)).toBe('12s');
    expect(formatOutlineDuration(90000)).toBe('2m');
    expect(formatOutlineDuration(7200000)).toBe('2h');
  });
});

describe('bucketOutline', () => {
  const entries = (kinds: OutlineKind[]): OutlineEntry[] =>
    kinds.map((kind, i) => ({ id: `b${i}`, label: `cmd-${i}`, kind }));

  it('has nothing to draw for an empty session', () => {
    expect(bucketOutline(entries([]), 8)).toEqual([]);
  });

  // A short session should read as a short strip, not be stretched to fill
  // the row, so the mark count is the block count until the slots run out.
  it('maps one mark per block while the blocks fit', () => {
    expect(bucketOutline(entries(['ok', 'fail', 'ai']), 8)).toEqual(['ok', 'fail', 'ai']);
  });

  it('fills every slot exactly when the counts match', () => {
    expect(bucketOutline(entries(['ok', 'fail', 'ok', 'ai']), 4)).toEqual(['ok', 'fail', 'ok', 'ai']);
  });

  it('compresses a long session to the slot count', () => {
    const kinds = Array.from({ length: 900 }, (): OutlineKind => 'ok');
    expect(bucketOutline(entries(kinds), 28)).toHaveLength(28);
  });

  // The point of the strip: compression may lose a success, never a failure.
  it('paints each bucket with the worst kind it holds', () => {
    const kinds: OutlineKind[] = ['ok', 'ok', 'fail', 'ok', 'ok', 'ok'];
    expect(bucketOutline(entries(kinds), 3)).toEqual(['ok', 'fail', 'ok']);
  });

  it('ranks run and ai above neutral and ok', () => {
    expect(bucketOutline(entries(['ok', 'neutral']), 1)).toEqual(['neutral']);
    expect(bucketOutline(entries(['neutral', 'ai']), 1)).toEqual(['ai']);
    expect(bucketOutline(entries(['ai', 'run']), 1)).toEqual(['run']);
    expect(bucketOutline(entries(['run', 'fail']), 1)).toEqual(['fail']);
  });

  it('keeps the axis linear, so a mark maps to its position in time', () => {
    const kinds = Array.from({ length: 100 }, (_, i): OutlineKind => (i === 50 ? 'fail' : 'ok'));
    const marks = bucketOutline(entries(kinds), 10);
    expect(marks.indexOf('fail')).toBe(5);
  });

  it('draws nothing rather than dividing by zero', () => {
    expect(bucketOutline(entries(['ok', 'fail']), 0)).toEqual([]);
  });
});
