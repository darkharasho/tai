import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const scriptPath = resolve(
  __dirname,
  '../../electron/shell-integration/tai-zsh.zsh',
);
const script = readFileSync(scriptPath, 'utf8');

describe('tai-zsh.zsh', () => {
  it('still emits OSC 133 A/B/C/D via native zsh hooks', () => {
    expect(script).toMatch(/__tai_osc133 "A"/);
    expect(script).toMatch(/__tai_osc133 "C"/);
    expect(script).toMatch(/__tai_osc133 "D;\$__ec"/);
    expect(script).toMatch(/\\e\]133;B\\a/);
  });

  it('guards against non-interactive shells and dumb terminals', () => {
    expect(script).toMatch(/\[\[ -o interactive \]\]/);
    expect(script).toMatch(/TERM.*dumb/);
  });

  it('defines an OSC 6973 emitter that hex-encodes JSON payloads', () => {
    expect(script).toMatch(/__tai_osc6973\s*\(\s*\)/);
    expect(script).toMatch(/\\e\]6973;/);
  });

  // The JSON escape function must handle ALL C0 control bytes (0x00-0x08,
  // 0x0B, 0x0C, 0x0E-0x1F) per RFC 8259 — copied from tai-bash.sh.
  it('defines a JSON escape function that handles all C0 control bytes', () => {
    expect(script).toMatch(/__tai_json_escape\s*\(\s*\)/);
    // Spot-check a few of the \u00XX escapes that must be present.
    expect(script).toContain('\\u0001');
    expect(script).toContain('\\u0008');
    expect(script).toContain('\\u000b');
    expect(script).toContain('\\u001b');
    expect(script).toContain('\\u001f');
  });

  it('emits OSC 6973 preexec from zsh native preexec hook', () => {
    // zsh's preexec receives the command as $1 — no DEBUG trap nonsense.
    expect(script).toContain('\\"hook\\":\\"preexec\\",\\"command\\"');
    expect(script).toMatch(/__tai_preexec\s*\(\s*\)/);
  });

  it('emits OSC 6973 precmd from zsh native precmd hook with required fields', () => {
    expect(script).toContain('\\"hook\\":\\"precmd\\"');
    expect(script).toContain('\\"exit\\":');
    expect(script).toContain('\\"signal\\":');
    expect(script).toContain('\\"duration_ms\\":');
    expect(script).toContain('\\"command\\":');
    expect(script).toContain('\\"cwd\\":');
  });

  it('uses EPOCHREALTIME (zmodload zsh/datetime) for millisecond timing', () => {
    expect(script).toMatch(/zmodload\s+zsh\/datetime/);
    expect(script).toMatch(/EPOCHREALTIME/);
  });

  it('registers preexec/precmd via add-zsh-hook', () => {
    expect(script).toMatch(/add-zsh-hook\s+preexec\s+__tai_preexec/);
    expect(script).toMatch(/add-zsh-hook\s+precmd\s+__tai_precmd/);
  });
});

describe('tai-zsh.zsh OSC 6973 emission (integration)', () => {
  it('emits preexec and precmd hooks around a real command', async () => {
    const { spawnSync } = await import('node:child_process');
    const { writeFileSync, readFileSync: readSync, mkdtempSync, rmSync } =
      await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { parseOsc6973 } = await import('@/utils/osc6973');

    const whichZsh = spawnSync('which', ['zsh'], { encoding: 'utf8' });
    const whichScript = spawnSync('which', ['script'], { encoding: 'utf8' });
    if (whichZsh.status !== 0 || whichScript.status !== 0) {
      // No zsh and/or no PTY tool — static-analysis tests cover wiring.
      return;
    }

    const dir = mkdtempSync(join(tmpdir(), 'tai-zsh-test-'));
    const cmdsPath = join(dir, 'cmds');
    const outPath = join(dir, 'out');
    writeFileSync(cmdsPath, `source ${scriptPath}\necho hi\nexit\n`);

    try {
      spawnSync(
        'script',
        ['-q', '-c', `zsh -f -i < ${cmdsPath}`, outPath],
        {
          encoding: 'utf8',
          timeout: 10_000,
          env: { ...process.env, TERM: 'xterm-256color' },
        },
      );
      const stdout = readSync(outPath, 'utf8');
      const re = /\x1b\]6973;([0-9a-f]+)\x07/g;
      const hooks: Array<Record<string, unknown>> = [];
      let m: RegExpExecArray | null;
      while ((m = re.exec(stdout)) !== null) {
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
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 15_000);
});
