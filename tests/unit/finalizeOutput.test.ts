import { describe, it, expect } from 'vitest';
import { preserveStreamedOutput } from '@/utils/finalizeOutput';
import type { SegmentedBlock } from '@/types';

function blk(output: string, rawOutput = output): SegmentedBlock {
  return { id: 'b', command: 'npm run dev', output, rawOutput, promptText: '', startTime: 0, duration: 1, isRemote: false } as SegmentedBlock;
}

describe('preserveStreamedOutput', () => {
  it('keeps the finalized output when it has content', () => {
    const out = preserveStreamedOutput(blk('real output'), { output: 'streamed', rawOutput: 'streamed' });
    expect(out.output).toBe('real output');
  });

  it('falls back to the streamed output when finalize produced nothing', () => {
    const out = preserveStreamedOutput(blk(''), { output: 'vite ready\n:5175', rawOutput: '\x1b[32mvite ready\x1b[0m\n:5175' });
    expect(out.output).toBe('vite ready\n:5175');
    expect(out.rawOutput).toContain('vite ready');
  });

  it('treats whitespace-only finalized output as empty', () => {
    const out = preserveStreamedOutput(blk('\n  \n'), { output: 'streamed', rawOutput: 'streamed' });
    expect(out.output).toBe('streamed');
  });

  it('leaves the block alone when neither side has content', () => {
    const b = blk('');
    expect(preserveStreamedOutput(b, { output: ' ', rawOutput: ' ' })).toBe(b);
    expect(preserveStreamedOutput(b, null)).toBe(b);
  });
});
