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
});
