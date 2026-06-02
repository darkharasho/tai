import { describe, it, expect } from 'vitest';
import { formatHistoryEntries } from '../../electron/services/historyFormat';

describe('formatHistoryEntries', () => {
  it('returns a placeholder for empty input', () => {
    expect(formatHistoryEntries([])).toBe('No terminal history available.');
  });

  it('renders command, non-zero exit, cwd, branch, and duration', () => {
    const text = formatHistoryEntries([
      { command: 'npm test', output: 'fail', exitCode: 1, cwd: '/p', gitBranch: 'main', durationMs: 1200 },
    ]);
    expect(text).toContain('$ npm test');
    expect(text).toContain('[exit 1]');
    expect(text).toContain('/p');
    expect(text).toContain('main');
    expect(text).toContain('1.2s');
    expect(text).toContain('fail');
  });

  it('omits the exit annotation for zero exit and truncates long output', () => {
    const text = formatHistoryEntries([
      { command: 'ls', output: 'x'.repeat(5000), exitCode: 0 },
    ]);
    expect(text).not.toContain('[exit');
    expect(text).toContain('truncated');
  });
});
