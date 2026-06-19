import { describe, it, expect } from 'vitest';
import { clampStoredOutput, MAX_STORED_OUTPUT_CHARS } from '@/utils/clampStoredOutput';

describe('clampStoredOutput', () => {
  it('returns the input unchanged when under budget', () => {
    expect(clampStoredOutput('hello', 100)).toBe('hello');
  });
  it('keeps the tail and notes truncation when over budget', () => {
    const out = clampStoredOutput('a'.repeat(1000), 100);
    expect(out.length).toBeLessThan(200);
    expect(out).toContain('truncated');
    expect(out.endsWith('a')).toBe(true);
  });
  it('has a sane default budget', () => {
    expect(MAX_STORED_OUTPUT_CHARS).toBeGreaterThan(100_000);
  });
});
