import { describe, it, expect } from 'vitest';
import { createModeResolver, INITIAL_MODE_STATE, type ModeSignal } from '@/utils/terminalMode';

/** Apply a sequence and return the inputOwner:provenance timeline. */
function timeline(signals: ModeSignal[]): string[] {
  const r = createModeResolver();
  return signals.map(s => {
    const st = r.apply(s);
    return `${st.inputOwner}:${st.provenance}`;
  });
}

describe('createModeResolver', () => {
  it('starts at the shell with no command running', () => {
    const r = createModeResolver();
    expect(r.state).toEqual(INITIAL_MODE_STATE);
    expect(r.state.inputOwner).toBe('shell');
    expect(r.state.commandRunning).toBe(false);
    expect(r.state.passwordPrompt).toBe(false);
  });
});

describe('rule 1: termios and altScreen are authoritative', () => {
  it('termios raw mode makes the program the input owner', () => {
    const r = createModeResolver();
    const st = r.apply({ kind: 'termios', icanon: false, echo: true });
    expect(st.inputOwner).toBe('program');
    expect(st.provenance).toBe('authoritative');
  });

  it('alt-screen entry makes it fullscreen', () => {
    const r = createModeResolver();
    const st = r.apply({ kind: 'altScreen', entered: true });
    expect(st.inputOwner).toBe('fullscreen');
    expect(st.provenance).toBe('authoritative');
  });

  it('alt-screen exit returns ownership to the shell', () => {
    const r = createModeResolver();
    r.apply({ kind: 'altScreen', entered: true });
    const st = r.apply({ kind: 'altScreen', entered: false });
    expect(st.inputOwner).toBe('shell');
    expect(st.provenance).toBe('authoritative');
  });

  it('termios returning to cooked mode returns ownership to the shell', () => {
    const r = createModeResolver();
    r.apply({ kind: 'termios', icanon: false, echo: true });
    const st = r.apply({ kind: 'termios', icanon: true, echo: true });
    expect(st.inputOwner).toBe('shell');
  });

  it('a later termios reading does not revoke a fullscreen takeover, in either icanon state', () => {
    const raw = createModeResolver();
    raw.apply({ kind: 'altScreen', entered: true });
    const rawSt = raw.apply({ kind: 'termios', icanon: false, echo: true });
    expect(rawSt.inputOwner).toBe('fullscreen');

    const cooked = createModeResolver();
    cooked.apply({ kind: 'altScreen', entered: true });
    const cookedSt = cooked.apply({ kind: 'termios', icanon: true, echo: true });
    expect(cookedSt.inputOwner).toBe('fullscreen');
  });
});

describe('rule 2: tuiHint may only promote', () => {
  it('promotes shell to program, marked inferred', () => {
    expect(timeline([{ kind: 'tuiHint' }])).toEqual(['program:inferred']);
  });

  it('never demotes fullscreen', () => {
    const r = createModeResolver();
    r.apply({ kind: 'altScreen', entered: true });
    const st = r.apply({ kind: 'tuiHint' });
    expect(st.inputOwner).toBe('fullscreen');
    expect(st.provenance).toBe('authoritative');
  });

  it('is ignored once termios has spoken for this command', () => {
    const r = createModeResolver();
    r.apply({ kind: 'osc133', phase: 'output' });
    r.apply({ kind: 'termios', icanon: true, echo: true });   // authoritative: cooked
    const st = r.apply({ kind: 'tuiHint' });
    expect(st.inputOwner).toBe('shell');
    expect(st.provenance).toBe('authoritative');
  });

  it('yields to a later authoritative signal that contradicts it', () => {
    expect(timeline([
      { kind: 'osc133', phase: 'output' },
      { kind: 'tuiHint' },
      { kind: 'termios', icanon: true, echo: true },
    ])).toEqual(['shell:authoritative', 'program:inferred', 'shell:authoritative']);
  });

  it('is confirmed by a later authoritative signal that agrees', () => {
    expect(timeline([
      { kind: 'osc133', phase: 'output' },
      { kind: 'tuiHint' },
      { kind: 'termios', icanon: false, echo: true },
    ])).toEqual(['shell:authoritative', 'program:inferred', 'program:authoritative']);
  });
});

describe('rule 3: program and fullscreen are distinct', () => {
  it('an Ink TUI that never enters alt screen is program, not fullscreen', () => {
    const r = createModeResolver();
    r.apply({ kind: 'osc133', phase: 'output' });
    r.apply({ kind: 'tuiHint' });
    const st = r.apply({ kind: 'termios', icanon: false, echo: true });
    expect(st.inputOwner).toBe('program');
  });

  it('htop entering the alt screen is fullscreen even in raw mode', () => {
    const r = createModeResolver();
    r.apply({ kind: 'termios', icanon: false, echo: true });
    const st = r.apply({ kind: 'altScreen', entered: true });
    expect(st.inputOwner).toBe('fullscreen');
  });
});

describe('rule 4: a command boundary resets inference', () => {
  it('a precmd hook returns ownership to the shell', () => {
    const r = createModeResolver();
    r.apply({ kind: 'tuiHint' });
    const st = r.apply({
      kind: 'hook',
      hook: { hook: 'precmd', exit: 0, signal: null, duration_ms: 1, command: 'x', cwd: '/' },
    });
    expect(st.inputOwner).toBe('shell');
    expect(st.commandRunning).toBe(false);
  });

  it('an OSC 133 prompt phase returns ownership to the shell', () => {
    const r = createModeResolver();
    r.apply({ kind: 'tuiHint' });
    const st = r.apply({ kind: 'osc133', phase: 'prompt' });
    expect(st.inputOwner).toBe('shell');
  });

  it('re-arms tuiHint for the next command after an authoritative signal', () => {
    expect(timeline([
      { kind: 'osc133', phase: 'output' },
      { kind: 'termios', icanon: true, echo: true },
      { kind: 'tuiHint' },                              // ignored: termios spoke
      { kind: 'osc133', phase: 'prompt' },              // boundary re-arms
      { kind: 'osc133', phase: 'output' },
      { kind: 'tuiHint' },                              // honoured again
    ])).toEqual([
      'shell:authoritative',
      'shell:authoritative',
      'shell:authoritative',
      'shell:authoritative',
      'shell:authoritative',
      'program:inferred',
    ]);
  });
});

describe('command running and password prompt', () => {
  it('tracks commandRunning across the OSC 133 phases', () => {
    const r = createModeResolver();
    expect(r.apply({ kind: 'osc133', phase: 'output' }).commandRunning).toBe(true);
    expect(r.apply({ kind: 'osc133', phase: 'prompt' }).commandRunning).toBe(false);
  });

  it('a preexec hook marks the command as running', () => {
    const r = createModeResolver();
    const st = r.apply({ kind: 'hook', hook: { hook: 'preexec', command: 'ls' } });
    expect(st.commandRunning).toBe(true);
  });

  it('flags the password-prompt termios shape without changing ownership', () => {
    const r = createModeResolver();
    const st = r.apply({ kind: 'termios', icanon: true, echo: false });
    expect(st.passwordPrompt).toBe(true);
    expect(st.inputOwner).toBe('shell');
  });

  it('clears the password flag when echo returns', () => {
    const r = createModeResolver();
    r.apply({ kind: 'termios', icanon: true, echo: false });
    const st = r.apply({ kind: 'termios', icanon: true, echo: true });
    expect(st.passwordPrompt).toBe(false);
  });

  it('does not flag a password prompt in raw mode', () => {
    const r = createModeResolver();
    const st = r.apply({ kind: 'termios', icanon: false, echo: false });
    expect(st.passwordPrompt).toBe(false);
    expect(st.inputOwner).toBe('program');
  });
});

describe('lifecycle', () => {
  it('ptyExit resets to the initial state', () => {
    const r = createModeResolver();
    r.apply({ kind: 'altScreen', entered: true });
    r.apply({ kind: 'osc133', phase: 'output' });
    const st = r.apply({ kind: 'ptyExit' });
    expect(st).toEqual(INITIAL_MODE_STATE);
  });

  it('reset() restores the initial state', () => {
    const r = createModeResolver();
    r.apply({ kind: 'altScreen', entered: true });
    r.reset();
    expect(r.state).toEqual(INITIAL_MODE_STATE);
  });

  it('returns a state object equal to the readable state property', () => {
    const r = createModeResolver();
    const returned = r.apply({ kind: 'tuiHint' });
    expect(returned).toEqual(r.state);
  });
});

describe('rule changes (Task 8)', () => {
  it('an authoritative cooked-mode reading overrules a stale TUI guess immediately', () => {
    // The old debounce meant a false tuiHint owned the surface for up to 700ms.
    // Now the correction applies the moment termios speaks.
    const r = createModeResolver();
    r.apply({ kind: 'osc133', phase: 'output' });
    expect(r.apply({ kind: 'tuiHint' }).inputOwner).toBe('program');
    const st = r.apply({ kind: 'termios', icanon: true, echo: true });
    expect(st.inputOwner).toBe('shell');
    expect(st.provenance).toBe('authoritative');
  });

  it('a transient raw-mode blip is not filtered by a timer, only by later signals', () => {
    // `brew` briefly drops ICANON for a progress bar. The old code debounced it
    // away; now the flip happens and the restore corrects it. Both are
    // authoritative and neither drops output (see Task 9).
    expect(timeline([
      { kind: 'osc133', phase: 'output' },
      { kind: 'termios', icanon: false, echo: true },
      { kind: 'termios', icanon: true, echo: true },
    ])).toEqual(['shell:authoritative', 'program:authoritative', 'shell:authoritative']);
  });
});

describe('revocable fullscreen (Task 8)', () => {
  // The legacy cursor-hide takeover has no authoritative entry signal: a cursor
  // hide is how both `vim`-without-alt-screen and a cooked spinner start. It
  // cannot reuse `altScreen`, because rule 3 would make it survive a cooked
  // termios reading and strand a spinner on `fullscreen`. `fullscreenHint` is
  // the revocable form: it claims the screen, stays labelled `inferred` so
  // retention never drops bytes on it, and yields to a cooked reading.
  it('claims the screen, but only as an inference', () => {
    const r = createModeResolver();
    const st = r.apply({ kind: 'fullscreenHint', entered: true });
    expect(st.inputOwner).toBe('fullscreen');
    expect(st.provenance).toBe('inferred');
  });

  it('survives a raw reading — a raw-mode program confirms the takeover', () => {
    const r = createModeResolver();
    r.apply({ kind: 'fullscreenHint', entered: true });
    const st = r.apply({ kind: 'termios', icanon: false, echo: true });
    expect(st.inputOwner).toBe('fullscreen');
    expect(st.provenance).toBe('inferred');
  });

  it('is revoked by a cooked reading — the spinner case', () => {
    const r = createModeResolver();
    r.apply({ kind: 'fullscreenHint', entered: true });
    const st = r.apply({ kind: 'termios', icanon: true, echo: true });
    expect(st.inputOwner).toBe('shell');
    expect(st.provenance).toBe('authoritative');
  });

  it('does not make a real alt screen revocable', () => {
    const r = createModeResolver();
    r.apply({ kind: 'altScreen', entered: true });
    expect(r.apply({ kind: 'termios', icanon: true, echo: true }).inputOwner).toBe('fullscreen');
  });

  it('is upgraded, not downgraded, by a real alt screen arriving after it', () => {
    const r = createModeResolver();
    r.apply({ kind: 'fullscreenHint', entered: true });
    r.apply({ kind: 'altScreen', entered: true });
    const st = r.apply({ kind: 'termios', icanon: true, echo: true });
    expect(st.inputOwner).toBe('fullscreen');
    expect(st.provenance).toBe('authoritative');
  });

  it('returns ownership to the shell on exit', () => {
    const r = createModeResolver();
    r.apply({ kind: 'fullscreenHint', entered: true });
    const st = r.apply({ kind: 'fullscreenHint', entered: false });
    expect(st.inputOwner).toBe('shell');
  });

  it('is cleared by a command boundary, so the next command starts revocable-free', () => {
    const r = createModeResolver();
    r.apply({ kind: 'fullscreenHint', entered: true });
    r.apply({ kind: 'osc133', phase: 'prompt' });
    expect(r.state.inputOwner).toBe('shell');
    const st = r.apply({ kind: 'termios', icanon: true, echo: true });
    expect(st.inputOwner).toBe('shell');
  });
});
