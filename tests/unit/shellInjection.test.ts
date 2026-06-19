import { describe, it, expect } from 'vitest';
import { buildIntegrationSourceCommand } from '../../electron/services/pty';

describe('buildIntegrationSourceCommand', () => {
  it('returns a leading-space fish source command', () => {
    const cmd = buildIntegrationSourceCommand('fish', "'/path/to/tai-fish.fish'");
    expect(cmd).toBe(" source '/path/to/tai-fish.fish'\n");
    expect(cmd[0]).toBe(' '); // leading space for history suppression
  });

  it('returns a leading-space bash dot-source command', () => {
    const cmd = buildIntegrationSourceCommand('bash', "'/path/to/tai-bash.sh'");
    expect(cmd).toBe(" . '/path/to/tai-bash.sh'\n");
    expect(cmd[0]).toBe(' ');
  });

  it('returns a leading-space zsh dot-source command', () => {
    const cmd = buildIntegrationSourceCommand('zsh', "'/path/to/tai-zsh.zsh'");
    expect(cmd).toBe(" . '/path/to/tai-zsh.zsh'\n");
    expect(cmd[0]).toBe(' ');
  });

  it('uses dot-source for unknown shells', () => {
    const cmd = buildIntegrationSourceCommand('sh', "'/path/to/script.sh'");
    expect(cmd).toBe(" . '/path/to/script.sh'\n");
  });

  it('handles paths with spaces correctly', () => {
    const cmd = buildIntegrationSourceCommand('bash', "'/path/to my/tai-bash.sh'");
    expect(cmd).toBe(" . '/path/to my/tai-bash.sh'\n");
    expect(cmd).toContain("'/path/to my/tai-bash.sh'");
  });

  it('always terminates with a newline', () => {
    for (const shell of ['bash', 'zsh', 'fish', 'sh']) {
      const cmd = buildIntegrationSourceCommand(shell, "'/p'");
      expect(cmd.endsWith('\n')).toBe(true);
    }
  });
});
