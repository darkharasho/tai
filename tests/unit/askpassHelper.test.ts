import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import {
  generateAskpassWrapper, generateAskpassHelperScript, buildAskpassEnv,
  sweepStaleAskpassDirs, ASKPASS_OWNER_FILE,
} from '../../electron/services/askpassHelper';

describe('buildAskpassEnv', () => {
  it('sets both vars on linux and darwin when the helper exists', () => {
    expect(buildAskpassEnv('tab_1', '/tmp/x/askpass', 'linux'))
      .toEqual({ SUDO_ASKPASS: '/tmp/x/askpass', TAI_ASKPASS_KEY: 'tab_1' });
    expect(buildAskpassEnv('tab_1', '/tmp/x/askpass', 'darwin'))
      .toEqual({ SUDO_ASKPASS: '/tmp/x/askpass', TAI_ASKPASS_KEY: 'tab_1' });
  });

  it('sets nothing on win32 or when the broker is not running', () => {
    expect(buildAskpassEnv('tab_1', '/tmp/x/askpass', 'win32')).toEqual({});
    expect(buildAskpassEnv('tab_1', null, 'linux')).toEqual({});
  });

  it('never touches process.env', () => {
    // Compare against the starting values: the suite may itself run under a
    // TAI AI tool, whose env legitimately carries both vars.
    const before = { SUDO_ASKPASS: process.env.SUDO_ASKPASS, TAI_ASKPASS_KEY: process.env.TAI_ASKPASS_KEY };
    buildAskpassEnv('tab_1', '/tmp/x/askpass', 'linux');
    expect({ SUDO_ASKPASS: process.env.SUDO_ASKPASS, TAI_ASKPASS_KEY: process.env.TAI_ASKPASS_KEY }).toEqual(before);
  });
});

describe('generateAskpassWrapper', () => {
  it('execs the given binary as node with the helper and forwards args, quoting paths', () => {
    const sh = generateAskpassWrapper("/opt/it's here/tai", '/tmp/d/askpass.cjs');
    expect(sh.startsWith('#!/bin/sh\n')).toBe(true);
    expect(sh).toContain(`ELECTRON_RUN_AS_NODE=1 exec '/opt/it'\\''s here/tai' '/tmp/d/askpass.cjs' "$@"`);
  });
});

describe.skipIf(process.platform === 'win32')('sweepStaleAskpassDirs', () => {
  let tmp: string;

  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tai-sweep-test-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  function makeDir(name: string, owner?: string): void {
    fs.mkdirSync(path.join(tmp, name));
    fs.writeFileSync(path.join(tmp, name, 'broker.sock.stale'), '');
    if (owner !== undefined) fs.writeFileSync(path.join(tmp, name, ASKPASS_OWNER_FILE), owner);
  }

  it('removes our dead, ownerless and garbled askpass dirs; keeps live ones and unrelated entries', () => {
    makeDir('tai-askpass-dead', '999999');
    makeDir('tai-askpass-live', '4242');
    makeDir('tai-askpass-noowner');
    makeDir('tai-askpass-garbled', 'not a pid');
    makeDir('tai-history-keep', '999999');
    fs.writeFileSync(path.join(tmp, 'tai-askpass-file'), '');

    const removed = sweepStaleAskpassDirs(tmp, (pid) => pid === 4242);

    expect(removed.sort()).toEqual(['tai-askpass-dead', 'tai-askpass-garbled', 'tai-askpass-noowner']);
    expect(fs.readdirSync(tmp).sort()).toEqual(['tai-askpass-file', 'tai-askpass-live', 'tai-history-keep']);
  });

  it('tolerates a missing temp dir', () => {
    expect(sweepStaleAskpassDirs(path.join(tmp, 'nope'))).toEqual([]);
  });
});

describe.skipIf(process.platform === 'win32')('helper process', () => {
  let dir: string;
  let socketPath: string;
  let wrapperPath: string;
  let server: net.Server | null = null;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tai-askpass-test-'));
    socketPath = path.join(dir, 'broker.sock');
    const helperPath = path.join(dir, 'askpass.cjs');
    fs.writeFileSync(helperPath, generateAskpassHelperScript(socketPath), { mode: 0o700 });
    wrapperPath = path.join(dir, 'askpass');
    // vitest runs under plain node; ELECTRON_RUN_AS_NODE is harmless there.
    fs.writeFileSync(wrapperPath, generateAskpassWrapper(process.execPath, helperPath), { mode: 0o700 });
  });

  afterEach(async () => {
    if (server) await new Promise<void>((r) => server!.close(() => r()));
    server = null;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function serve(onLine: (line: string, sock: net.Socket) => void): Promise<void> {
    return new Promise((resolve) => {
      server = net.createServer((sock) => {
        let buf = '';
        sock.setEncoding('utf8');
        sock.on('data', (c: string) => {
          buf += c;
          const nl = buf.indexOf('\n');
          if (nl >= 0) onLine(buf.slice(0, nl), sock);
        });
        sock.on('error', () => {});
      });
      server.listen(socketPath, () => resolve());
    });
  }

  function run(): Promise<{ code: number | null; stdout: string; pid: number }> {
    return new Promise((resolve) => {
      const child = spawn(wrapperPath, ['[sudo] password for someone:'], {
        env: { ...process.env, TAI_ASKPASS_KEY: 'tab_7' },
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      let stdout = '';
      child.stdout!.setEncoding('utf8');
      child.stdout!.on('data', (c: string) => { stdout += c; });
      child.on('close', (code) => resolve({ code, stdout, pid: child.pid! }));
    });
  }

  it('sends its own pid (exec keeps it), the key and the prompt', async () => {
    let received: any = null;
    await serve((line, sock) => { received = JSON.parse(line); sock.end('{"ok":false}\n'); });
    const r = await run();
    expect(received).toEqual({ pid: r.pid, key: 'tab_7', prompt: '[sudo] password for someone:' });
  });

  it('prints a returned secret and exits 0', async () => {
    await serve((_l, sock) => sock.end('{"ok":true,"secret":"hunter2"}\n'));
    expect(await run()).toMatchObject({ code: 0, stdout: 'hunter2\n' });
  });

  it('exits 1 and prints nothing when ok arrives without a secret', async () => {
    await serve((_l, sock) => sock.end('{"ok":true}\n'));
    expect(await run()).toMatchObject({ code: 1, stdout: '' });
  });

  it('exits 1 on refusal', async () => {
    await serve((_l, sock) => sock.end('{"ok":false}\n'));
    expect(await run()).toMatchObject({ code: 1, stdout: '' });
  });

  it('exits 1 when the broker hangs up without replying', async () => {
    await serve((_l, sock) => sock.destroy());
    expect(await run()).toMatchObject({ code: 1, stdout: '' });
  });

  it('exits 1 when no broker is listening', async () => {
    expect(await run()).toMatchObject({ code: 1, stdout: '' });
  });
});
