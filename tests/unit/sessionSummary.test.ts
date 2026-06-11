import { describe, it, expect } from 'vitest';
import { summarizeSession } from '@/utils/sessionSummary';

describe('summarizeSession', () => {
  it('includes the port and line count for a server', () => {
    expect(summarizeSession('server', 'a\nb\nc', 3000)).toBe(':3000 · 3 lines');
  });

  it('falls back to line count when no port was seen', () => {
    expect(summarizeSession('watch', 'a\nb', null)).toBe('2 lines');
  });

  it('labels agent sessions', () => {
    expect(summarizeSession('agent', 'x\ny\nz\nw', null)).toBe('agent session · 4 lines');
  });

  it('formats large counts with separators', () => {
    const out = Array.from({ length: 1204 }, () => 'l').join('\n');
    expect(summarizeSession('server', out, null)).toBe('1,204 lines');
  });

  it('handles empty output', () => {
    expect(summarizeSession('server', '', 8080)).toBe(':8080 · 0 lines');
  });
});
