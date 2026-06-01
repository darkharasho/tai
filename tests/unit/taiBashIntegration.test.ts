import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const script = readFileSync(
  resolve(__dirname, '../../electron/shell-integration/tai-bash.sh'),
  'utf8',
);

describe('tai-bash.sh', () => {
  // Regression: the previous version installed `trap '__tai_preexec' DEBUG`,
  // which Ptyxis/vte's PROMPT_COMMAND would clobber on every prompt cycle.
  // OSC 133 C never reached the segmenter, the segmenter stayed in
  // 'command' phase, and live output never streamed into the pending card.
  // The fix is to emit C from PS0 (expanded by bash after Enter, before
  // exec), which is independent of any DEBUG trap.
  it('emits the OSC 133 C preexec marker via PS0, not via a DEBUG trap', () => {
    expect(script).toMatch(/^PS0=/m);
    // PS0 must contain the OSC 133 C byte sequence: ESC ] 133 ; C BEL.
    expect(script).toMatch(/PS0=.*\\e\]133;C\\a/);
    // No DEBUG trap should remain — those fight other integrations.
    expect(script).not.toMatch(/\btrap\b[^#\n]*\bDEBUG\b/);
  });

  it('emits OSC 133 A (prompt-start) from PROMPT_COMMAND', () => {
    expect(script).toMatch(/PROMPT_COMMAND=.*__tai_prompt_invoke/);
    expect(script).toMatch(/__tai_osc133 "A"/);
  });

  it('appends OSC 133 B (prompt-end) to PS1 idempotently', () => {
    expect(script).toMatch(/PS1=.*\\\[\\033\]133;B\\007\\\]/);
  });

  it('preserves the user\'s existing PROMPT_COMMAND', () => {
    expect(script).toMatch(/__tai_user_pc="\$\{PROMPT_COMMAND\}"/);
    expect(script).toMatch(/eval "\$__tai_user_pc"/);
  });

  it('guards against re-sourcing', () => {
    expect(script).toMatch(/__TAI_LOADED/);
  });

  // OSC 6973: hex-encoded JSON sidechannel for structured command metadata.
  // Hooks must be emitted without a DEBUG trap (per regression test above)
  // so we use PS0 for preexec and PROMPT_COMMAND for precmd.
  it('defines an OSC 6973 emitter that hex-encodes JSON payloads', () => {
    expect(script).toMatch(/__tai_osc6973\s*\(\s*\)/);
    expect(script).toMatch(/\\033\]6973;%s\\007/);
  });

  it('emits OSC 6973 preexec from PS0 (not a DEBUG trap)', () => {
    expect(script).toMatch(/__tai_preexec_emit\s*\(\s*\)/);
    expect(script).toContain('\\"hook\\":\\"preexec\\",\\"command\\"');
    // PS0 must wire the preexec emitter alongside OSC 133 C.
    expect(script).toMatch(/PS0=.*__tai_preexec_emit/);
    // Still no DEBUG trap.
    expect(script).not.toMatch(/\btrap\b[^#\n]*\bDEBUG\b/);
  });

  it('emits OSC 6973 precmd from PROMPT_COMMAND with exit/signal/duration/cwd', () => {
    expect(script).toContain('\\"hook\\":\\"precmd\\"');
    expect(script).toContain('\\"exit\\":$__ec');
    expect(script).toContain('\\"signal\\":$signal');
    expect(script).toContain('\\"duration_ms\\":$duration_ms');
    expect(script).toContain('\\"cwd\\":\\"$cwd_esc\\"');
  });

  it('persists per-command preexec state via tempfile (PS0 runs in a subshell)', () => {
    // PS0 expansion is in a command substitution, so variable assignments do
    // not propagate. State must be persisted through the filesystem.
    expect(script).toMatch(/__TAI_STATE_DIR=/);
    expect(script).toMatch(/\$__TAI_STATE_DIR\/pending/);
    expect(script).toMatch(/\$__TAI_STATE_DIR\/start/);
    expect(script).toMatch(/\$__TAI_STATE_DIR\/cmd/);
  });

  it('only emits precmd when a command actually ran (pending marker present)', () => {
    expect(script).toMatch(/if \[ -f "\$__TAI_STATE_DIR\/pending" \]/);
  });
});

describe('tai-bash.sh OSC 6973 emission (integration)', () => {
  it('emits preexec and precmd hooks around a real command', async () => {
    const { spawnSync } = await import('node:child_process');
    const { writeFileSync, readFileSync: readSync, mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { parseOsc6973 } = await import('@/utils/osc6973');
    const scriptPath = resolve(__dirname, '../../electron/shell-integration/tai-bash.sh');

    // `script(1)` is required to allocate a PTY so PROMPT_COMMAND fires.
    const which = spawnSync('which', ['script'], { encoding: 'utf8' });
    if (which.status !== 0) {
      // Skip silently when no PTY tool; static-analysis tests still cover wiring.
      return;
    }

    const dir = mkdtempSync(join(tmpdir(), 'tai-bash-test-'));
    const cmdsPath = join(dir, 'cmds');
    const outPath = join(dir, 'out');
    writeFileSync(cmdsPath, `source ${scriptPath}\necho hi\nexit\n`);

    try {
      // util-linux script: `script -q -c CMD FILE`. Redirect stdin from a
      // file so the input persists into the child's interactive bash.
      spawnSync(
        'script',
        ['-q', '-c', `bash --norc --noprofile -i < ${cmdsPath}`, outPath],
        {
          encoding: 'utf8',
          timeout: 10_000,
          // Test runners (including Claude Code) often set TERM=dumb, which
          // makes our integration script intentionally bail. Force xterm so
          // the script loads.
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

  // Regression: __tai_json_escape previously only escaped \, ", \n, \r, \t.
  // Other C0 control bytes (0x00-0x08, 0x0B, 0x0C, 0x0E-0x1F) leaked through
  // verbatim and produced invalid JSON per RFC 8259, which parseOsc6973
  // silently dropped. The fix escapes all C0 bytes as \u00XX.
  it('produces parseable JSON when a command contains a C0 control byte', async () => {
    const { spawnSync } = await import('node:child_process');
    const { writeFileSync, readFileSync: readSync, mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { parseOsc6973 } = await import('@/utils/osc6973');
    const scriptPath = resolve(__dirname, '../../electron/shell-integration/tai-bash.sh');

    const which = spawnSync('which', ['script'], { encoding: 'utf8' });
    if (which.status !== 0) {
      return;
    }

    const dir = mkdtempSync(join(tmpdir(), 'tai-bash-c0-test-'));
    const cmdsPath = join(dir, 'cmds');
    const outPath = join(dir, 'out');
    // `printf 'a\x01b'` puts a literal SOH (0x01) byte in the printed output,
    // and the command string itself contains the bash-expanded $'\x01' once
    // history records it; either way the escape function must handle it.
    writeFileSync(
      cmdsPath,
      `source ${scriptPath}\nprintf 'a\\x01b\\n'\nexit\n`,
    );

    try {
      spawnSync(
        'script',
        ['-q', '-c', `bash --norc --noprofile -i < ${cmdsPath}`, outPath],
        {
          encoding: 'utf8',
          timeout: 10_000,
          env: { ...process.env, TERM: 'xterm-256color' },
        },
      );
      const stdout = readSync(outPath, 'utf8');
      const re = /\x1b\]6973;([0-9a-f]+)\x07/g;
      let totalPayloads = 0;
      let parseable = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(stdout)) !== null) {
        totalPayloads++;
        const parsed = parseOsc6973(m[1]);
        if (parsed) parseable++;
      }
      // Every OSC 6973 payload emitted must be valid parseable JSON.
      expect(totalPayloads, `stdout=${JSON.stringify(stdout)}`).toBeGreaterThan(0);
      expect(parseable).toBe(totalPayloads);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 15_000);
});
