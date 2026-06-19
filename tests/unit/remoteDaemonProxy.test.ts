import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockSpawn = vi.fn();
vi.mock('child_process', () => ({ spawn: (...a: any[]) => mockSpawn(...a) }));

import { RemoteDaemonProxy, DAEMON_CALL_TIMEOUT_MS, PONG_TIMEOUT_MS } from '../../electron/services/remoteDaemonProxy';

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

describe('RemoteDaemonProxy pong timeout', () => {
  afterEach(() => vi.useRealTimers());

  it('disconnects when pongs stop arriving', () => {
    vi.useFakeTimers();
    const proc = mockProc();
    mockSpawn.mockReturnValue(proc);
    const proxy = new RemoteDaemonProxy('user@host');
    (proxy as any).proc = proc;
    const onDisconnect = vi.fn();
    proxy.setOnDisconnect(onDisconnect);

    // Simulate ready → starts heartbeat and sets _lastPong.
    (proxy as any)._handleMessage({ type: 'ready' });
    // No pongs ever arrive.
    vi.advanceTimersByTime(PONG_TIMEOUT_MS + 60_000);

    expect(proxy.isConnected()).toBe(false);
    expect(onDisconnect).toHaveBeenCalled();
    vi.useRealTimers();
  });
});

describe('RemoteDaemonProxy._handleExit double-invocation guard', () => {
  afterEach(() => vi.useRealTimers());

  it('calls onDisconnect exactly once even when _handleExit is triggered by pong-timeout and then directly', () => {
    vi.useFakeTimers();
    const proc = mockProc();
    mockSpawn.mockReturnValue(proc);
    const proxy = new RemoteDaemonProxy('user@host');
    (proxy as any).proc = proc;
    const onDisconnect = vi.fn();
    proxy.setOnDisconnect(onDisconnect);

    // Simulate ready → starts heartbeat.
    (proxy as any)._handleMessage({ type: 'ready' });

    // Advance past PONG_TIMEOUT_MS so the heartbeat interval fires _handleExit once.
    vi.advanceTimersByTime(PONG_TIMEOUT_MS + 60_000);

    // Call _handleExit again directly (simulates the process exit event arriving after pong-timeout).
    (proxy as any)._handleExit();

    // onDisconnect must have been called exactly once.
    expect(onDisconnect).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
