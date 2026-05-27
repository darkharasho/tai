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
});
