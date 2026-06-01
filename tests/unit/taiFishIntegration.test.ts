import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const scriptPath = resolve(
  __dirname,
  '../../electron/shell-integration/tai-fish.fish',
);
const script = readFileSync(scriptPath, 'utf8');

describe('tai-fish.fish', () => {
  it('still emits OSC 133 A/B/C/D via fish events', () => {
    expect(script).toMatch(/__tai_osc133 A/);
    expect(script).toMatch(/__tai_osc133 C/);
    expect(script).toMatch(/__tai_osc133 "D;/);
    expect(script).toMatch(/__tai_osc133 B/);
  });

  it('guards against non-interactive shells and dumb terminals', () => {
    expect(script).toMatch(/status is-interactive/);
    expect(script).toMatch(/TERM.*dumb/);
  });

  it('defines an OSC 6973 emitter that hex-encodes JSON payloads', () => {
    expect(script).toMatch(/function __tai_osc6973/);
    expect(script).toMatch(/\\e\]6973;/);
  });

  // The JSON escape function must handle ALL C0 control bytes (0x00-0x08,
  // 0x0B, 0x0C, 0x0E-0x1F) per RFC 8259.
  it('defines a JSON escape function that handles all C0 control bytes', () => {
    expect(script).toMatch(/__tai_json_escape/);
    expect(script).toContain('\\u0001');
    expect(script).toContain('\\u0008');
    expect(script).toContain('\\u000b');
    expect(script).toContain('\\u001b');
    expect(script).toContain('\\u001f');
  });

  it('emits OSC 6973 preexec from fish_preexec event', () => {
    expect(script).toContain('\\"hook\\":\\"preexec\\",\\"command\\"');
    expect(script).toMatch(/--on-event\s+fish_preexec/);
  });

  it('emits OSC 6973 precmd with all required fields', () => {
    expect(script).toContain('\\"hook\\":\\"precmd\\"');
    expect(script).toContain('\\"exit\\":');
    expect(script).toContain('\\"signal\\":');
    expect(script).toContain('\\"duration_ms\\":');
    expect(script).toContain('\\"command\\":');
    expect(script).toContain('\\"cwd\\":');
  });

  it('maps signal exit codes (128 < exit < 165) to SIGn strings', () => {
    expect(script).toMatch(/SIG/);
    expect(script).toMatch(/128/);
  });
});

describe('tai-fish.fish OSC 6973 emission (integration)', () => {
  it('emits preexec and precmd hooks around a real command', async () => {
    const { spawnSync } = await import('node:child_process');
    const { parseOsc6973 } = await import('@/utils/osc6973');

    const whichFish = spawnSync('which', ['fish'], { encoding: 'utf8' });
    if (whichFish.status !== 0) {
      return;
    }

    // We need a real pty to make fish run its interactive event loop and
    // emit fish_preexec / fish_prompt events. node-pty provides this.
    let pty: typeof import('node-pty');
    try {
      pty = await import('node-pty');
    } catch {
      // node-pty not loadable in this environment — static checks cover wiring.
      return;
    }

    const term = pty.spawn('fish', ['-i', '-N'], {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd: process.cwd(),
      env: { ...process.env, TERM: 'xterm-256color' } as Record<string, string>,
    });

    let buf = '';
    term.onData((d) => {
      buf += d;
      // Fish 4.x probes the terminal at startup and blocks until it gets
      // responses for Primary Device Attributes (CSI 0 c) and background-
      // color (OSC 11;?). Reply on its behalf so it proceeds to draw a prompt.
      if (d.includes('\x1b[c') || d.includes('\x1b[0c')) {
        term.write('\x1b[?62;c');
      }
      if (d.includes('\x1b]11;?')) {
        term.write('\x1b]11;rgb:0000/0000/0000\x1b\\');
      }
    });

    const done = new Promise<void>((resolve) => term.onExit(() => resolve()));

    await new Promise((r) => setTimeout(r, 800));
    term.write(`source ${scriptPath}\r`);
    await new Promise((r) => setTimeout(r, 600));
    term.write(`echo hi\r`);
    await new Promise((r) => setTimeout(r, 600));
    term.write(`exit\r`);

    // Bound the wait so a hang doesn't stall the suite.
    await Promise.race([
      done,
      new Promise<void>((r) => setTimeout(r, 3_000)),
    ]);
    try { term.kill(); } catch { /* already exited */ }

    const re = /\x1b\]6973;([0-9a-f]+)\x07/g;
    const hooks: Array<Record<string, unknown>> = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(buf)) !== null) {
      const parsed = parseOsc6973(m[1]);
      if (parsed) hooks.push(parsed as unknown as Record<string, unknown>);
    }

    const preexec = hooks.find(
      (h) =>
        h.hook === 'preexec' &&
        typeof h.command === 'string' &&
        (h.command as string).includes('echo hi'),
    );
    const precmd = hooks.find(
      (h) =>
        h.hook === 'precmd' &&
        h.exit === 0 &&
        typeof h.command === 'string' &&
        (h.command as string).includes('echo hi'),
    );
    expect(preexec, `hooks=${JSON.stringify(hooks)}`).toBeDefined();
    expect(precmd, `hooks=${JSON.stringify(hooks)}`).toBeDefined();
    expect(precmd?.duration_ms as number).toBeGreaterThanOrEqual(0);
    expect(typeof precmd?.cwd).toBe('string');
  }, 15_000);
});
