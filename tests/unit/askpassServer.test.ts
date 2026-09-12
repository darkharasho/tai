import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import { parseAskpassRequest, startAskpassServer } from '../../electron/services/askpassServer';
import { AskpassBroker } from '../../electron/services/askpassBroker';
import { resolveSudoParent } from '../../electron/services/sudoParent';
import { generateAskpassHelperScript, generateAskpassWrapper } from '../../electron/services/askpassHelper';

describe('parseAskpassRequest', () => {
  it('accepts a well-formed request', () => {
    expect(parseAskpassRequest({ pid: 42, key: 'tab_1', prompt: 'p' })).toEqual({ pid: 42, key: 'tab_1', prompt: 'p' });
  });

  it('rejects bad shapes', () => {
    expect(parseAskpassRequest(null)).toBeNull();
    expect(parseAskpassRequest({ pid: '42', key: 'k', prompt: '' })).toBeNull();
    expect(parseAskpassRequest({ pid: 1, key: 'k', prompt: '' })).toBeNull();
    expect(parseAskpassRequest({ pid: 42.5, key: 'k', prompt: '' })).toBeNull();
    expect(parseAskpassRequest({ pid: 42, key: 7, prompt: '' })).toBeNull();
    expect(parseAskpassRequest({ pid: 42, key: '', prompt: '' })).toBeNull();
    expect(parseAskpassRequest({ pid: 42, key: 'x'.repeat(201), prompt: '' })).toBeNull();
  });

  it('truncates a long prompt and defaults a missing one', () => {
    expect(parseAskpassRequest({ pid: 42, key: 'k', prompt: 'x'.repeat(1000) })!.prompt).toHaveLength(500);
    expect(parseAskpassRequest({ pid: 42, key: 'k' })!.prompt).toBe('');
  });
});

describe.skipIf(process.platform === 'win32')('askpass server (real sockets and processes)', () => {
  let dir: string;
  let socketPath: string;
  let wrapperPath: string;
  let server: net.Server | null = null;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tai-askpass-srv-'));
    socketPath = path.join(dir, 'broker.sock');
    const helperPath = path.join(dir, 'askpass.cjs');
    fs.writeFileSync(helperPath, generateAskpassHelperScript(socketPath), { mode: 0o700 });
    wrapperPath = path.join(dir, 'askpass');
    fs.writeFileSync(wrapperPath, generateAskpassWrapper(process.execPath, helperPath), { mode: 0o700 });
  });

  afterEach(async () => {
    if (server) await new Promise<void>((r) => server!.close(() => r()));
    server = null;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function runHelper(): Promise<{ code: number | null; stdout: string }> {
    return new Promise((resolve) => {
      const child = spawn(wrapperPath, ['[sudo] password:'], {
        env: { ...process.env, TAI_ASKPASS_KEY: 'tab_1' },
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      let stdout = '';
      child.stdout!.setEncoding('utf8');
      child.stdout!.on('data', (c: string) => { stdout += c; });
      child.on('close', (code) => resolve({ code, stdout }));
    });
  }

  it('SECURITY: a helper not spawned by sudo gets nothing, even with a cached secret', async () => {
    const SECRET = 'do-not-leak';
    const vault = {
      isSet: () => true,
      get: vi.fn(() => Buffer.from(SECRET)),
      set: vi.fn(),
      clear: vi.fn(),
    };
    const send = vi.fn();
    const broker = new AskpassBroker({
      resolveSudoParent,            // the real check; our parent is vitest, not sudo
      vault,
      send,
      timeoutMs: 5_000,
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h as NodeJS.Timeout),
    });
    server = await startAskpassServer(broker, socketPath);

    const r = await runHelper();

    expect(r).toEqual({ code: 1, stdout: '' });
    expect(vault.get).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('delivers a verified auto-fill end-to-end over the socket', async () => {
    const SECRET = 'e2e-secret';
    const vault = {
      isSet: () => true,
      get: vi.fn(() => Buffer.from(SECRET)),
      set: vi.fn(),
      clear: vi.fn(),
    };
    const send = vi.fn();
    const broker = new AskpassBroker({
      resolveSudoParent: () => 4100,  // stand-in for a verified sudo parent
      vault,
      send,
      timeoutMs: 5_000,
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h as NodeJS.Timeout),
    });
    server = await startAskpassServer(broker, socketPath);

    expect(await runHelper()).toEqual({ code: 0, stdout: `${SECRET}\n` });
    expect(send).toHaveBeenCalledWith('ai:message', 'tab_1', { type: 'sudo_auth' });
    expect(JSON.stringify(send.mock.calls)).not.toContain(SECRET);
  });

  it('relays a broker reply to the helper', async () => {
    server = await startAskpassServer(
      { handleRequest: (_req, reply) => { reply({ ok: true, secret: 's3cret' }); return () => {}; } },
      socketPath,
    );
    expect(await runHelper()).toEqual({ code: 0, stdout: 's3cret\n' });
  });

  it('cancels the request when the helper disconnects before a reply', async () => {
    const cancel = vi.fn();
    server = await startAskpassServer({ handleRequest: () => cancel }, socketPath);
    const sock = net.createConnection(socketPath);
    await new Promise<void>((r) => sock.on('connect', () => r()));
    sock.write(JSON.stringify({ pid: 4242, key: 'tab_1', prompt: '' }) + '\n');
    await new Promise((r) => setTimeout(r, 50));
    sock.destroy();
    await vi.waitFor(() => expect(cancel).toHaveBeenCalled());
  });

  it('refuses malformed input without calling the broker', async () => {
    const handleRequest = vi.fn();
    server = await startAskpassServer({ handleRequest }, socketPath);
    const reply = await new Promise<string>((resolve) => {
      const sock = net.createConnection(socketPath);
      let buf = '';
      sock.setEncoding('utf8');
      sock.on('data', (c: string) => { buf += c; });
      sock.on('close', () => resolve(buf));
      sock.on('connect', () => sock.write('not json\n'));
    });
    expect(reply).toBe('{"ok":false}\n');
    expect(handleRequest).not.toHaveBeenCalled();
  });

  it('restricts the socket file to the owner', async () => {
    server = await startAskpassServer({ handleRequest: () => () => {} }, socketPath);
    expect(fs.statSync(socketPath).mode & 0o077).toBe(0);
  });
});
