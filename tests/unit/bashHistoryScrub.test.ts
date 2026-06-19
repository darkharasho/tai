/**
 * Tests for the bash self-scrub block in tai-bash.sh.
 *
 * Strategy: spawn a real `bash --norc -i` process and drive it via stdin,
 * using the actual `. 'path'` dot-source form (matching what TAI injects).
 * We check that the bootstrap line is absent from history while prior real
 * commands are preserved.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

const BASH = '/bin/bash';
const TAI_BASH = path.resolve(__dirname, '../../electron/shell-integration/tai-bash.sh');

// Skip the whole suite if bash isn't available or the script doesn't exist.
const hasBash = (() => {
  try { execFileSync(BASH, ['--version'], { timeout: 3000 }); return true; }
  catch { return false; }
})();
const scriptExists = fs.existsSync(TAI_BASH);

/**
 * Run a bash script in interactive mode (so history builtins work) and return
 * stdout, filtering out OSC sequences TAI emits. We pass TERM=xterm so the
 * interactive-shell guard (`case "$-" in *i*)`) and TERM guard pass.
 */
function runBash(script: string): string {
  const result = execFileSync(BASH, ['--norc', '-i'], {
    input: script,
    timeout: 10_000,
    encoding: 'utf8',
    env: {
      ...process.env,
      HISTFILE: '',         // no persistent history file
      HISTSIZE: '1000',
      HISTCONTROL: '',      // don't suppress anything by default
      TERM: 'xterm',        // pass tai-bash.sh's `dumb` guard
    },
    stdio: ['pipe', 'pipe', 'pipe'], // capture both stdout and stderr
  });
  // Strip OSC 133 / 6973 escape sequences emitted by tai's hooks.
  return result.replace(/\x1b\][0-9;]*[^\x07]*\x07/g, '');
}

describe.skipIf(!hasBash || !scriptExists)('bash history self-scrub (tai-bash.sh)', () => {
  it('removes the bootstrap dot-source entry from history', () => {
    // Simulate exactly what TAI does: inject `. 'tai-bash.sh'` as a command.
    // In an interactive bash session this command is recorded to history, then
    // executed. Inside the script `history 1` sees the bootstrap line and
    // deletes it.
    const script = `
set -o history
history -s "ls"
 . "${TAI_BASH}"
HISTTIMEFORMAT='' history
`;
    const out = runBash(script);
    const basename = path.basename(TAI_BASH); // "tai-bash.sh"
    // The bootstrap line must have been deleted — its filename should not appear.
    expect(out).not.toMatch(basename);
    // The pre-existing real command must still be present.
    expect(out).toMatch(/ls/);
  });

  it('does NOT delete a pre-existing real command', () => {
    const script = `
set -o history
history -s "git status"
history -s "echo hello world"
 . "${TAI_BASH}"
HISTTIMEFORMAT='' history
`;
    const out = runBash(script);
    // Both commands should survive — only the bootstrap line is scrubbed.
    expect(out).toMatch(/git status/);
    expect(out).toMatch(/echo hello world/);
  });

  it('leaves history unchanged when no bootstrap line is present', () => {
    // Source the script directly without first having a matching history entry.
    // The guard should not delete anything.
    const script = `
set -o history
history -s "echo hello"
history -s "git status"
source "${TAI_BASH}"
HISTTIMEFORMAT='' history
`;
    const out = runBash(script);
    // The pre-seeded commands should still be present (source != ., different guard).
    // Specifically, at minimum neither should be spuriously wiped.
    // Note: `source` also contains the script path; it WILL match the guard since
    // it ends with the basename. That's intentional — both `. path` and
    // `source path` are injection forms. The real commands seeded earlier survive.
    expect(out).toMatch(/echo hello/);
    expect(out).toMatch(/git status/);
  });

  it('self-scrub guard checks filename — unrelated commands are safe', () => {
    // A command containing a completely different path is never deleted.
    const basename = path.basename(TAI_BASH); // "tai-bash.sh"
    const unrelatedScript = `
set -o history
history -s "cat /tmp/other-script.sh"
 . "${TAI_BASH}"
HISTTIMEFORMAT='' history
`;
    const out = runBash(unrelatedScript);
    // The unrelated command path (other-script.sh) must survive.
    expect(out).toMatch(/other-script\.sh/);
    // The bootstrap entry itself should be gone.
    expect(out).not.toMatch(basename);
  });
});
