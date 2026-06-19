import { describe, it, expect } from 'vitest';
import { isBootstrapEchoLine } from '@/utils/bootstrapEcho';

describe('isBootstrapEchoLine', () => {
  it('matches the injected bootstrap echo (with leading space + quotes)', () => {
    expect(isBootstrapEchoLine(" . '/tmp/x/tai-bash.sh'")).toBe(true);
    expect(isBootstrapEchoLine(". /home/u/.config/tai/shell-integration.sh")).toBe(true);
    expect(isBootstrapEchoLine(" source '/a/b/tai-zsh.zsh'")).toBe(true);
  });
  it('does NOT match a real command that merely mentions the script', () => {
    expect(isBootstrapEchoLine('cat tai-bash.sh')).toBe(false);
    expect(isBootstrapEchoLine('vim /x/tai-bash.sh')).toBe(false);
    expect(isBootstrapEchoLine('git diff tai-bash.sh')).toBe(false);
    expect(isBootstrapEchoLine('echo source tai-bash.sh')).toBe(false);
  });
  it('does not match empty / unrelated lines', () => {
    expect(isBootstrapEchoLine('')).toBe(false);
    expect(isBootstrapEchoLine('ls -la')).toBe(false);
  });
});
