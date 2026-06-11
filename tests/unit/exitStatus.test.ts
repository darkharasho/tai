import { describe, it, expect } from 'vitest';
import { classifyExit } from '@/utils/exitStatus';

describe('classifyExit', () => {
  it('treats exit 0 as success', () => {
    expect(classifyExit(0)).toBe('success');
  });

  it('treats unknown exit codes as unknown', () => {
    expect(classifyExit(undefined)).toBe('unknown');
  });

  it('treats non-zero exits as failure', () => {
    expect(classifyExit(1)).toBe('failure');
    expect(classifyExit(127)).toBe('failure');
  });

  it('treats Ctrl-C (130) and SIGPIPE (141) as neutral, like Warp', () => {
    expect(classifyExit(130)).toBe('neutral');
    expect(classifyExit(141)).toBe('neutral');
  });

  it('treats a signal-terminated command as neutral', () => {
    expect(classifyExit(143, 'SIG15')).toBe('neutral');
  });
});
