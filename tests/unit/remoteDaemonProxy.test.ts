import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockSpawn = vi.fn();
vi.mock('child_process', () => ({ spawn: (...a: any[]) => mockSpawn(...a) }));

import { RemoteDaemonProxy, DAEMON_CALL_TIMEOUT_MS } from '../../electron/services/remoteDaemonProxy';

function mockProc() {
  const proc: any = {
    stdin: { write: vi.fn(), writable: true },
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    killed: false,
    kill: vi.fn(() => { proc.killed = true; }),
    on: vi.fn(),
  };
  return proc;
}

describe('RemoteDaemonProxy.executeTool timeout', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); });
  afterEach(() => vi.useRealTimers());

  it('resolves with an error result if the daemon never responds', async () => {
    const proc = mockProc();
    mockSpawn.mockReturnValue(proc);
    const proxy = new RemoteDaemonProxy('user@host');
    // Force ready without a real handshake.
    (proxy as any).proc = proc;
    (proxy as any).ready = true;

    const p = proxy.executeTool('Bash', { command: 'sleep 999' });
    vi.advanceTimersByTime(DAEMON_CALL_TIMEOUT_MS + 10);
    const result = await p;

    expect(result.isError).toBe(true);
    expect(result.output).toMatch(/timed out/i);
    expect((proxy as any).pending.size).toBe(0);
  });
});
