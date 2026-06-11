import { describe, it, expect } from 'vitest';
import { buildSessionAiPrompt } from '@/utils/sessionAiPrompt';
import type { SegmentedBlock } from '@/types';

const block = {
  id: 'b1',
  command: 'rails server',
  output: Array.from({ length: 300 }, (_, i) => `log line ${i + 1}`).join('\n'),
  rawOutput: '',
  promptText: '',
  startTime: 0,
  duration: 0,
  isRemote: false,
} as SegmentedBlock;

describe('buildSessionAiPrompt', () => {
  it('frames the question with the running command and an output tail', () => {
    const p = buildSessionAiPrompt('why is it slow?', block, 3000);
    expect(p).toContain('rails server');
    expect(p).toContain(':3000');
    expect(p).toContain('log line 300');
    expect(p).not.toContain('log line 1\n'); // tail-capped, not the full log
    expect(p.trim().endsWith('why is it slow?')).toBe(true);
  });

  it('redacts secrets from the output tail', () => {
    const leaky = { ...block, output: 'PASSWORD=hunter2\nready' } as SegmentedBlock;
    const p = buildSessionAiPrompt('q?', leaky, null);
    expect(p).not.toContain('hunter2');
  });

  it('omits the port line when unknown', () => {
    const p = buildSessionAiPrompt('q?', block, null);
    expect(p).not.toContain('port');
  });
});
