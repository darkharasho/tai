import { describe, it, expect } from 'vitest';
import { buildRecentContext } from '@/utils/aiContext';
import type { DisplayItem } from '@/components/BlockList';

function cmd(id: string, command: string, output = '', exitCode?: number): DisplayItem {
  return {
    type: 'command',
    active: false,
    block: {
      id, command, output, exitCode,
      rawOutput: output, promptText: '$', startTime: 0, duration: 0,
      isRemote: false, hooksAvailable: false,
    } as any,
  };
}

describe('buildRecentContext', () => {
  it('returns empty text and the latest id when there are no new commands', () => {
    const items = [cmd('b1', 'ls'), cmd('b2', 'pwd')];
    const r = buildRecentContext(items, 'b2');
    expect(r.text).toBe('');
    expect(r.lastId).toBe('b2');
  });

  it('selects only command blocks after sinceId', () => {
    const items = [cmd('b1', 'ls'), cmd('b2', 'pwd'), cmd('b3', 'whoami')];
    const r = buildRecentContext(items, 'b1');
    expect(r.text).toContain('$ pwd');
    expect(r.text).toContain('$ whoami');
    expect(r.text).not.toContain('$ ls');
    expect(r.lastId).toBe('b3');
  });

  it('includes all completed commands when sinceId is null', () => {
    const items = [cmd('b1', 'ls'), cmd('b2', 'pwd')];
    const r = buildRecentContext(items, null);
    expect(r.text).toContain('$ ls');
    expect(r.text).toContain('$ pwd');
  });

  it('annotates [exit N] only for non-zero exits', () => {
    const items = [cmd('b1', 'true', '', 0), cmd('b2', 'false', '', 1)];
    const r = buildRecentContext(items, null);
    expect(r.text).toContain('$ true');
    expect(r.text).not.toContain('$ true  [exit');
    expect(r.text).toContain('$ false  [exit 1]');
  });

  it('includes output only for the most recent command and any failed command', () => {
    const items = [
      cmd('b1', 'cmd-old', 'old-output', 0),
      cmd('b2', 'cmd-fail', 'fail-output', 1),
      cmd('b3', 'cmd-last', 'last-output', 0),
    ];
    const r = buildRecentContext(items, null);
    expect(r.text).not.toContain('old-output');
    expect(r.text).toContain('fail-output');
    expect(r.text).toContain('last-output');
  });

  it('truncates output to maxOutputChars', () => {
    const big = 'x'.repeat(5000);
    const items = [cmd('b1', 'big', big, 0)];
    const r = buildRecentContext(items, null, undefined, { maxOutputChars: 100 });
    expect(r.text).toContain('chars truncated');
    expect(r.text.length).toBeLessThan(1600);
  });

  it('caps the number of commands to maxCommands (keeping the most recent)', () => {
    const items = Array.from({ length: 10 }, (_, i) => cmd(`b${i}`, `cmd${i}`));
    const r = buildRecentContext(items, null, undefined, { maxCommands: 3 });
    expect(r.text).toContain('$ cmd9');
    expect(r.text).toContain('$ cmd7');
    expect(r.text).not.toContain('$ cmd6');
  });

  it('emits a cwd/git status line when provided', () => {
    const items = [cmd('b1', 'ls')];
    const withBranch = buildRecentContext(items, null, { cwd: '/p', gitBranch: 'main' });
    expect(withBranch.text).toContain('cwd: /p (git: main)');
    const noBranch = buildRecentContext(items, null, { cwd: '/p', gitBranch: null });
    expect(noBranch.text).toContain('cwd: /p');
    expect(noBranch.text).not.toContain('(git:');
  });

  it('enforces budgetChars by dropping oldest output then oldest commands', () => {
    const items = Array.from({ length: 5 }, (_, i) =>
      cmd(`b${i}`, `cmd${i}`, 'y'.repeat(400), i === 1 ? 1 : 0));
    const r = buildRecentContext(items, null, undefined, { budgetChars: 300, maxOutputChars: 400 });
    expect(r.text.length).toBeLessThanOrEqual(300);
    expect(r.text).toContain('$ cmd4');
  });
});
