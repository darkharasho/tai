import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSpawn = vi.fn();
vi.mock('child_process', () => ({
  spawn: (...args: any[]) => mockSpawn(...args),
}));

import { RemoteSshManager } from '../../electron/services/remoteSsh';

function createMockProcess() {
  const proc: any = {
    stdin: { write: vi.fn() },
    stdout: { on: vi.fn(), removeAllListeners: vi.fn() },
    stderr: { on: vi.fn(), removeAllListeners: vi.fn() },
    killed: false,
    kill: vi.fn(() => { proc.killed = true; }),
    on: vi.fn(),
    pid: 12345,
  };
  return proc;
}

describe('RemoteSshManager', () => {
  let manager: RemoteSshManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new RemoteSshManager();
  });

  it('connects to a remote host by spawning ssh', async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);

    proc.stdout.on.mockImplementation((event: string, cb: Function) => {
      if (event === 'data') {
        setTimeout(() => cb(Buffer.from('__TAI_READY__\n')), 10);
      }
    });

    await manager.connect('tab-1', 'user@host');

    expect(mockSpawn).toHaveBeenCalledWith('ssh', [
      '-o', 'BatchMode=yes',
      '-o', 'ConnectTimeout=10',
      'user@host',
      'bash', '--norc', '--noprofile',
    ], expect.any(Object));
  });

  it('returns connection status', async () => {
    expect(manager.isConnected('tab-1')).toBe(false);

    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);
    proc.stdout.on.mockImplementation((event: string, cb: Function) => {
      if (event === 'data') {
        setTimeout(() => cb(Buffer.from('__TAI_READY__\n')), 10);
      }
    });

    await manager.connect('tab-1', 'user@host');
    expect(manager.isConnected('tab-1')).toBe(true);
  });

  it('disconnects and kills the process', async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);
    proc.stdout.on.mockImplementation((event: string, cb: Function) => {
      if (event === 'data') {
        setTimeout(() => cb(Buffer.from('__TAI_READY__\n')), 10);
      }
    });

    await manager.connect('tab-1', 'user@host');
    manager.disconnect('tab-1');

    expect(proc.kill).toHaveBeenCalled();
    expect(manager.isConnected('tab-1')).toBe(false);
  });

  it('destroyAll kills all connections', async () => {
    const proc1 = createMockProcess();
    const proc2 = createMockProcess();
    mockSpawn.mockReturnValueOnce(proc1).mockReturnValueOnce(proc2);

    proc1.stdout.on.mockImplementation((event: string, cb: Function) => {
      if (event === 'data') setTimeout(() => cb(Buffer.from('__TAI_READY__\n')), 10);
    });
    proc2.stdout.on.mockImplementation((event: string, cb: Function) => {
      if (event === 'data') setTimeout(() => cb(Buffer.from('__TAI_READY__\n')), 10);
    });

    await manager.connect('tab-1', 'user@host1');
    await manager.connect('tab-2', 'user@host2');
    manager.destroyAll();

    expect(proc1.kill).toHaveBeenCalled();
    expect(proc2.kill).toHaveBeenCalled();
  });

  // Helper: connect a mock process and return the active stdout handler
  // (the one registered by _sendAndWaitReady, which is what _checkFence runs through)
  async function connectWithHandlers(proc: any): Promise<{ stdoutHandler: () => Function }> {
    // _sendAndWaitReady calls stdout.removeAllListeners then stdout.on.
    // We want to capture the last 'data' handler registered (from _sendAndWaitReady).
    // Fire the ready marker on every 'data' registration so both initial and
    // _sendAndWaitReady handlers receive it — _sendAndWaitReady's check() will resolve.
    proc.stdout.on.mockImplementation((event: string, cb: Function) => {
      if (event === 'data') {
        setTimeout(() => cb(Buffer.from('__TAI_READY__\n')), 10);
      }
    });

    await manager.connect('tab-1', 'user@host');

    // After connect, grab the last handler registered on stdout (from _sendAndWaitReady)
    const calls = proc.stdout.on.mock.calls.filter((c: any[]) => c[0] === 'data');
    const lastHandler = calls[calls.length - 1][1] as Function;
    return { stdoutHandler: () => lastHandler };
  }

  it('execute() sends fenced command, parses output and exit code', async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);

    const { stdoutHandler } = await connectWithHandlers(proc);

    // Capture stdin writes after connect
    const writtenCommands: string[] = [];
    proc.stdin.write.mockImplementation((data: string) => {
      writtenCommands.push(data);
    });

    const executePromise = manager.execute('tab-1', 'echo hello', 5000);

    // execute() writes synchronously; yield to let promise machinery settle
    await new Promise(r => setTimeout(r, 5));

    const fencedCmd = writtenCommands.find(c => c.includes('__TAI_START_'));
    expect(fencedCmd).toBeTruthy();
    const fenceId = fencedCmd!.match(/__TAI_START_(tai_\d+_\w+)__/)![1];

    // Deliver fenced output through the active stdout handler
    stdoutHandler()(Buffer.from(`__TAI_START_${fenceId}__\nhello\n__TAI_END_${fenceId}__ 0\n`));

    const result = await executePromise;
    expect(result.output).toBe('hello');
    expect(result.exitCode).toBe(0);
  });

  it('execute() captures non-zero exit codes', async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);

    const { stdoutHandler } = await connectWithHandlers(proc);

    const writtenCommands: string[] = [];
    proc.stdin.write.mockImplementation((data: string) => {
      writtenCommands.push(data);
    });

    const executePromise = manager.execute('tab-1', 'false', 5000);
    await new Promise(r => setTimeout(r, 5));

    const fencedCmd = writtenCommands.find(c => c.includes('__TAI_START_'));
    const fenceId = fencedCmd!.match(/__TAI_START_(tai_\d+_\w+)__/)![1];

    stdoutHandler()(Buffer.from(`__TAI_START_${fenceId}__\n__TAI_END_${fenceId}__ 1\n`));

    const result = await executePromise;
    expect(result.exitCode).toBe(1);
    expect(result.output).toBe('');
  });

  it('getCwd() calls execute with pwd and returns trimmed output', async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);

    const { stdoutHandler } = await connectWithHandlers(proc);

    const writtenCommands: string[] = [];
    proc.stdin.write.mockImplementation((data: string) => {
      writtenCommands.push(data);
    });

    const cwdPromise = manager.getCwd('tab-1');
    await new Promise(r => setTimeout(r, 5));

    const fencedCmd = writtenCommands.find(c => c.includes('pwd'));
    expect(fencedCmd).toBeTruthy();

    const fenceId = fencedCmd!.match(/__TAI_START_(tai_\d+_\w+)__/)![1];
    stdoutHandler()(Buffer.from(`__TAI_START_${fenceId}__\n/home/user\n__TAI_END_${fenceId}__ 0\n`));

    const cwd = await cwdPromise;
    expect(cwd).toBe('/home/user');
  });

  it('connection timeout rejects connect() and disconnects', async () => {
    vi.useFakeTimers();

    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);

    // Never emit ready — let timeout fire
    proc.stdout.on.mockImplementation(() => {});

    const connectPromise = manager.connect('tab-1', 'user@host');

    // Advance past the 10s SSH ready timeout
    vi.advanceTimersByTime(11000);

    await expect(connectPromise).rejects.toThrow('SSH connection timed out');
    expect(proc.kill).toHaveBeenCalled();
    expect(manager.isConnected('tab-1')).toBe(false);

    vi.useRealTimers();
  });

  it('rejects an in-flight command when the ssh process exits', async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);

    let exitHandler: Function = () => {};
    proc.on.mockImplementation((event: string, cb: Function) => {
      if (event === 'exit') exitHandler = cb;
    });

    const { stdoutHandler } = await connectWithHandlers(proc);
    void stdoutHandler; // not needed here

    const p = manager.execute('tab-1', 'sleep 999', 30000);
    // Process dies mid-command.
    exitHandler();

    await expect(p).rejects.toThrow(/connection lost|exited/i);
  });

  it('stderr during connect surfaces auth error immediately', async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);

    let stderrHandler: Function | null = null;
    proc.stdout.on.mockImplementation(() => {}); // Never ready
    proc.stderr.on.mockImplementation((event: string, cb: Function) => {
      if (event === 'data') {
        stderrHandler = cb;
        // Emit auth error shortly after registration
        setTimeout(() => cb(Buffer.from('Permission denied (publickey).\n')), 10);
      }
    });

    await expect(manager.connect('tab-1', 'user@host')).rejects.toThrow(
      'Permission denied (publickey).'
    );
    expect(proc.kill).toHaveBeenCalled();
    expect(manager.isConnected('tab-1')).toBe(false);
  });
});
