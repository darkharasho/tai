import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInPty, osc6973Payloads, findModernBash } from '../helpers/scriptPty';

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
    const { parseOsc6973 } = await import('@/utils/osc6973');
    const scriptPath = resolve(__dirname, '../../electron/shell-integration/tai-bash.sh');

    // PS0 (bash >= 4.4) is what emits preexec; on a 3.2 host there is nothing
    // to assert. Static-analysis tests above still cover the wiring.
    const bash = findModernBash();
    if (!bash) return;

    const transcript = await runInPty(
      bash,
      ['--norc', '--noprofile', '-i'],
      `source ${scriptPath}\necho hi\nexit\n`,
    );
    if (transcript === null) return;
    const hooks = osc6973Payloads(transcript)
      .map((hex) => parseOsc6973(hex))
      .filter(Boolean) as unknown as Array<Record<string, unknown>>;

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
  }, 20_000);

  // Regression: __tai_json_escape previously only escaped \, ", \n, \r, \t.
  // Other C0 control bytes (0x00-0x08, 0x0B, 0x0C, 0x0E-0x1F) leaked through
  // verbatim and produced invalid JSON per RFC 8259, which parseOsc6973
  // silently dropped. The fix escapes all C0 bytes as \u00XX.
  it('produces parseable JSON when a command contains a C0 control byte', async () => {
    const { parseOsc6973 } = await import('@/utils/osc6973');
    const scriptPath = resolve(__dirname, '../../electron/shell-integration/tai-bash.sh');

    // `printf 'a\x01b'` puts a literal SOH (0x01) byte in the printed output,
    // and the command string itself contains the bash-expanded $'\x01' once
    // history records it; either way the escape function must handle it.
    const bash = findModernBash();
    if (!bash) return;

    const transcript = await runInPty(
      bash,
      ['--norc', '--noprofile', '-i'],
      `source ${scriptPath}\nprintf 'a\\x01b\\n'\nexit\n`,
    );
    if (transcript === null) return;
    const payloads = osc6973Payloads(transcript);
    const parseable = payloads.filter((hex) => parseOsc6973(hex)).length;

    // Every OSC 6973 payload emitted must be valid parseable JSON.
    expect(payloads.length, `transcript=${JSON.stringify(transcript)}`).toBeGreaterThan(0);
    expect(parseable).toBe(payloads.length);
  }, 20_000);
});
