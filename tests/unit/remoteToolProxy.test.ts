import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RemoteToolProxy } from '../../electron/services/remoteToolProxy';

function createMockSshManager() {
  return {
    isConnected: vi.fn().mockReturnValue(true),
    execute: vi.fn().mockResolvedValue({ output: 'mock output', exitCode: 0 }),
    getCwd: vi.fn().mockResolvedValue('/home/user'),
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn(),
    destroyAll: vi.fn(),
  };
}

describe('RemoteToolProxy', () => {
  let proxy: RemoteToolProxy;
  let ssh: ReturnType<typeof createMockSshManager>;

  beforeEach(() => {
    ssh = createMockSshManager();
    proxy = new RemoteToolProxy(ssh as any);
  });

  it('executes Bash tool via SSH', async () => {
    const result = await proxy.executeRemoteTool('tab-1', 'Bash', { command: 'ls -la' });

    expect(ssh.execute).toHaveBeenCalledWith('tab-1', 'ls -la', 30000);
    expect(result.output).toBe('mock output');
    expect(result.isError).toBe(false);
  });

  it('executes Read tool as cat command', async () => {
    ssh.execute.mockResolvedValue({ output: '     1\tline one\n     2\tline two', exitCode: 0 });

    const result = await proxy.executeRemoteTool('tab-1', 'Read', { file_path: '/etc/hosts' });

    expect(ssh.execute).toHaveBeenCalledWith('tab-1', "cat -n '/etc/hosts'", 30000);
  });

  it('executes Read tool with offset and limit', async () => {
    const result = await proxy.executeRemoteTool('tab-1', 'Read', {
      file_path: '/etc/hosts',
      offset: 10,
      limit: 20,
    });

    expect(ssh.execute).toHaveBeenCalledWith(
      'tab-1',
      "cat -n '/etc/hosts' | tail -n +10 | head -n 20",
      30000,
    );
  });

  it('executes Write tool as heredoc', async () => {
    const content = 'line 1\nline 2\n';
    const result = await proxy.executeRemoteTool('tab-1', 'Write', {
      file_path: '/tmp/test.txt',
      content,
    });

    const call = ssh.execute.mock.calls[0][1] as string;
    expect(call).toContain("cat << 'TAI_EOF_");
    expect(call).toContain("> '/tmp/test.txt'");
    expect(call).toContain(content);
  });

  it('executes Grep tool as grep command', async () => {
    const result = await proxy.executeRemoteTool('tab-1', 'Grep', {
      pattern: 'TODO',
      path: '/home/user/project',
    });

    const call = ssh.execute.mock.calls[0][1] as string;
    expect(call).toContain('grep');
    expect(call).toContain('TODO');
  });

  it('executes Glob tool as find command', async () => {
    const result = await proxy.executeRemoteTool('tab-1', 'Glob', {
      pattern: '**/*.ts',
      path: '/home/user/project',
    });

    const call = ssh.execute.mock.calls[0][1] as string;
    expect(call).toContain('find');
    expect(call).toContain('.ts');
  });

  it('returns error for unsupported tools', async () => {
    const result = await proxy.executeRemoteTool('tab-1', 'Edit', {
      file_path: '/tmp/test.txt',
      old_string: 'a',
      new_string: 'b',
    });

    expect(result.isError).toBe(true);
    expect(result.output).toContain('not available on remote hosts');
    expect(ssh.execute).not.toHaveBeenCalled();
  });

  it('reports non-zero exit code as error', async () => {
    ssh.execute.mockResolvedValue({ output: 'No such file', exitCode: 1 });

    const result = await proxy.executeRemoteTool('tab-1', 'Bash', { command: 'cat missing' });

    expect(result.isError).toBe(true);
    expect(result.output).toContain('No such file');
  });

  it('handles SSH execution failure gracefully', async () => {
    ssh.execute.mockRejectedValue(new Error('Connection lost'));

    const result = await proxy.executeRemoteTool('tab-1', 'Bash', { command: 'ls' });

    expect(result.isError).toBe(true);
    expect(result.output).toContain('Connection lost');
  });
});
