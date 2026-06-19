import { describe, it, expect } from 'vitest';
import { buildNextCommandPrompt, extractCommand } from '@/utils/aiNextCommand';

describe('aiNextCommand', () => {
  it('builds a prompt mentioning the last command and cwd', () => {
    const p = buildNextCommandPrompt({ lastCommand: 'git add .', recentCommands: ['ls', 'git add .'], cwd: '/proj' });
    expect(p).toContain('git add .');
    expect(p).toContain('/proj');
  });
  it('extracts a command from a fenced block', () => {
    expect(extractCommand('Sure:\n```bash\ngit commit -m "x"\n```')).toBe('git commit -m "x"');
  });
  it('extracts the first plausible line when no fence', () => {
    expect(extractCommand('git push')).toBe('git push');
  });
  it('returns null for empty/garbage', () => {
    expect(extractCommand('')).toBeNull();
  });
});
