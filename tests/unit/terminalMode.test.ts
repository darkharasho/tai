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

  it('ends at a command boundary, like every other claim on the input', () => {
    // Renamed from "is cleared by a command boundary, so the next command
    // starts revocable-free" — that name claimed coverage this does not have.
    // The `fullscreenRevocable = false` in the boundary branches is DEFENSIVE,
    // not load-bearing, and deleting it leaves this green: rule 3a's guard only
    // reads the flag while inputOwner is already 'fullscreen', and the only two
    // signals that can set 'fullscreen' (altScreen, fullscreenHint) each write
    // the flag on the way in. So a stale latch is unreachable by construction
    // and no test can observe it. What IS worth pinning is what this asserts:
    // the boundary returns ownership to the shell and a later cooked reading
    // agrees. See the note at the resets in terminalMode.ts.
    const r = createModeResolver();
    r.apply({ kind: 'fullscreenHint', entered: true });
    r.apply({ kind: 'osc133', phase: 'prompt' });
    expect(r.state.inputOwner).toBe('shell');
    const st = r.apply({ kind: 'termios', icanon: true, echo: true });
    expect(st.inputOwner).toBe('shell');
  });
});

describe('degraded mode', () => {
  it('marks raw-mode decisions degraded when termios is unavailable', () => {
    const r = createModeResolver();
    r.apply({ kind: 'sourceUnavailable', source: 'termios' });
    r.apply({ kind: 'osc133', phase: 'output' });
    const st = r.apply({ kind: 'tuiHint' });
    expect(st.inputOwner).toBe('program');
    expect(st.provenance).toBe('degraded');
    expect(st.degradedReason).toBe('no-termios');
  });

  it('keeps alt-screen decisions authoritative when only termios is missing', () => {
    // Degradation is per-source, never global: Windows has no termios but
    // alt-screen escapes still arrive.
    const r = createModeResolver();
    r.apply({ kind: 'sourceUnavailable', source: 'termios' });
    const st = r.apply({ kind: 'altScreen', entered: true });
    expect(st.inputOwner).toBe('fullscreen');
    // Per-source-ness lives in the PROVENANCE: this decision needed no termios,
    // so it is authoritative. `degradedReason` is a read of the session's open
    // gaps, not of this decision, so it keeps reporting the missing termios —
    // clearing it here is what used to make the field flap.
    expect(st.provenance).toBe('authoritative');
    expect(st.degradedReason).toBe('no-termios');
  });

  it('marks the decisions hooks answer degraded when hooks are unavailable', () => {
    const r = createModeResolver();
    r.apply({ kind: 'sourceUnavailable', source: 'hooks' });
    // The synthesized boundary is the decision a real marker would have made:
    // without hooks it is a heuristic wearing a marker's clothes.
    const st = r.apply({ kind: 'osc133', phase: 'idle' });
    expect(st.provenance).toBe('degraded');
    expect(st.degradedReason).toBe('no-hooks');
    // A raw-mode guess is termios's question. A missing hooks source says
    // nothing about it and used to degrade it anyway.
    const hint = r.apply({ kind: 'tuiHint' });
    expect(hint.provenance).toBe('inferred');
    expect(hint.degradedReason).toBe('no-hooks');
  });

  it('self-heals when the missing source starts reporting', () => {
    const r = createModeResolver();
    r.apply({ kind: 'sourceUnavailable', source: 'hooks' });
    expect(r.apply({ kind: 'osc133', phase: 'idle' }).provenance).toBe('degraded');

    // A remote host that gains integration starts emitting hooks. No resolver
    // change is needed for this to promote — that is what makes a future
    // Warpify push a drop-in.
    const st = r.apply({
      kind: 'hook',
      hook: { hook: 'precmd', exit: 0, signal: null, duration_ms: 1, command: 'x', cwd: '/' },
    });
    expect(st.provenance).toBe('authoritative');
    expect(st.degradedReason).toBeUndefined();
    // The two assertions above survive deleting the self-heal outright: the
    // precmd branch hardcodes provenance 'authoritative' and degradedReason
    // undefined, so they hold whether or not the gap was actually closed.
    // The gap is only observable on the NEXT decision that consults it, and a
    // boundary is exactly what re-arms the hint path — so this is the line
    // that distinguishes a healed session from one that merely looks healed
    // for a single frame. It has to be a decision hooks are the authority for —
    // a tuiHint is termios's question and would read 'inferred' either way.
    expect(r.apply({ kind: 'osc133', phase: 'idle' }).provenance).toBe('authoritative');
  });

  // Each real marker heals independently — asserted one at a time, because a
  // test that fires several of them cannot tell which one did the work.
  it('a real OSC 133 command marker heals the hooks gap on its own', () => {
    const r = createModeResolver();
    r.apply({ kind: 'sourceUnavailable', source: 'hooks' });
    r.apply({ kind: 'osc133', phase: 'command' });
    const healed = r.apply({ kind: 'osc133', phase: 'idle' });
    expect(healed.provenance).toBe('authoritative');
    expect(healed.degradedReason).toBeUndefined();
  });

  it('a termios reading clears a termios degradation', () => {
    const r = createModeResolver();
    r.apply({ kind: 'sourceUnavailable', source: 'termios' });
    const st = r.apply({ kind: 'termios', icanon: false, echo: true });
    expect(st.provenance).toBe('authoritative');
    expect(st.degradedReason).toBeUndefined();
    // `degradedReason` is now derived from the open-gap set rather than
    // hardcoded by this branch, so the assertion above observes the heal
    // directly. The provenance one still does not — take a decision that
    // consults the gap. The boundary releases the command's authoritative latch
    // so the hint is live again, and the hint routes through degrade();
    // 'inferred' means the gap really closed.
    r.apply({ kind: 'osc133', phase: 'idle' });
    expect(r.apply({ kind: 'tuiHint' }).provenance).toBe('inferred');
  });

  // The brief's five cases above all clear the degradation with the SAME source
  // they declared missing, so none of them can tell a per-source `unavailable`
  // set from a single global boolean. These do.
  it('a hook does not clear a termios degradation', () => {
    const r = createModeResolver();
    r.apply({ kind: 'sourceUnavailable', source: 'termios' });
    r.apply({ kind: 'hook', hook: { hook: 'preexec', command: 'x' } });
    const st = r.apply({ kind: 'tuiHint' });
    expect(st.provenance).toBe('degraded');
    expect(st.degradedReason).toBe('no-termios');
  });

  it('a termios reading does not clear a hooks degradation', () => {
    const r = createModeResolver();
    r.apply({ kind: 'sourceUnavailable', source: 'hooks' });
    // A cooked reading leaves the owner on 'shell' and says nothing about hooks.
    // Asserted ON the reading rather than stepped around: this intermediate
    // state is where the field used to blank itself, and it is live for however
    // long it takes the next signal to arrive.
    const st = r.apply({ kind: 'termios', icanon: true, echo: true });
    // The line-discipline question is answered, and answering it is what lets
    // retention resolve its buffer — that property must survive the gap.
    expect(st.provenance).toBe('authoritative');
    // ...and the hooks gap is still open, because nothing closed it.
    expect(st.degradedReason).toBe('no-hooks');
    // The reading latched authoritativeThisCommand, so a boundary is needed
    // before a hint is listened to again. The SYNTHETIC boundary, which is the
    // only kind a session with no hooks can ever produce — and it is the
    // decision the gap actually bears on.
    const boundary = r.apply({ kind: 'osc133', phase: 'idle' });
    expect(boundary.provenance).toBe('degraded');
    expect(boundary.degradedReason).toBe('no-hooks');
  });

  // The one that decides whether this feature works at all for its headline
  // case. TerminalSession synthesizes a boundary from the segmenter's own
  // prompt heuristics every time a block ends; if that counted as proof of
  // shell integration, a remote session would clear its own degradation on the
  // first remote prompt and nothing would ever re-declare it.
  it('a synthesized block boundary is not proof that hooks work', () => {
    const r = createModeResolver();
    r.apply({ kind: 'sourceUnavailable', source: 'hooks' });
    const boundary = r.apply({ kind: 'osc133', phase: 'idle' });
    expect(boundary.inputOwner).toBe('shell');
    expect(boundary.commandRunning).toBe(false);
    expect(boundary.provenance).toBe('degraded');
    expect(boundary.degradedReason).toBe('no-hooks');
    // And it did not heal itself on the way through: the next one is degraded
    // too, for the same reason.
    expect(r.apply({ kind: 'osc133', phase: 'idle' }).provenance).toBe('degraded');
  });

  // Windows quits vim. The alt-screen escape is authoritative about the screen
  // and about nothing else; without re-degrading here the session would sit on
  // 'shell:authoritative' forever and the ConPTY fallback would be gone for
  // every command after the first TUI.
  it('re-degrades on leaving the alt screen when termios is missing', () => {
    const r = createModeResolver();
    r.apply({ kind: 'sourceUnavailable', source: 'termios' });
    expect(r.apply({ kind: 'altScreen', entered: true }).provenance).toBe('authoritative');
    const st = r.apply({ kind: 'altScreen', entered: false });
    expect(st.inputOwner).toBe('shell');
    expect(st.provenance).toBe('degraded');
    expect(st.degradedReason).toBe('no-termios');
  });

  // A marker proves hooks work; it proves nothing about the line discipline,
  // which is the question that matters once a command is actually running.
  it('re-degrades when a command starts and termios cannot report', () => {
    const r = createModeResolver();
    r.apply({ kind: 'sourceUnavailable', source: 'termios' });
    expect(r.apply({ kind: 'osc133', phase: 'prompt' }).provenance).toBe('authoritative');
    const st = r.apply({ kind: 'osc133', phase: 'output' });
    expect(st.commandRunning).toBe(true);
    expect(st.provenance).toBe('degraded');
    expect(st.degradedReason).toBe('no-termios');

    const viaHook = createModeResolver();
    viaHook.apply({ kind: 'sourceUnavailable', source: 'termios' });
    const hk = viaHook.apply({ kind: 'hook', hook: { hook: 'preexec', command: 'x' } });
    expect(hk.commandRunning).toBe(true);
    expect(hk.provenance).toBe('degraded');
  });

  // An OSC 133 prompt marker IS proof hooks work, so unlike a tuiHint it clears
  // the degradation rather than being routed through degrade().
  it('an OSC 133 prompt clears a hooks degradation', () => {
    const r = createModeResolver();
    r.apply({ kind: 'sourceUnavailable', source: 'hooks' });
    expect(r.apply({ kind: 'tuiHint' }).degradedReason).toBe('no-hooks');
    const st = r.apply({ kind: 'osc133', phase: 'prompt' });
    expect(st.provenance).toBe('authoritative');
    expect(st.degradedReason).toBeUndefined();
    // Same masking as the precmd branch: the provenance above is hardcoded by
    // that branch and holds even with the heal deleted. This one observes it.
    expect(r.apply({ kind: 'osc133', phase: 'idle' }).provenance).toBe('authoritative');
  });

  it('drops every declared gap on pty exit and on reset', () => {
    const r = createModeResolver();
    r.apply({ kind: 'sourceUnavailable', source: 'termios' });
    r.apply({ kind: 'sourceUnavailable', source: 'hooks' });
    expect(r.apply({ kind: 'tuiHint' }).provenance).toBe('degraded');
    r.apply({ kind: 'ptyExit' });
    expect(r.apply({ kind: 'tuiHint' }).provenance).toBe('inferred');

    // The hooks gap is probed on a decision hooks answer, which is the only
    // place it is visible in the provenance.
    r.apply({ kind: 'sourceUnavailable', source: 'hooks' });
    expect(r.apply({ kind: 'osc133', phase: 'idle' }).provenance).toBe('degraded');
    r.reset();
    expect(r.apply({ kind: 'osc133', phase: 'idle' }).provenance).toBe('authoritative');
  });

  // ...but only against the question the current state answered. The state a
  // termios reading resolved is authoritative because termios spoke; learning
  // that hooks are missing is news about a different question and must not
  // retroactively turn that reading into a guess (retention would then refuse
  // to drop a confirmed TUI's frames for the rest of the command).
  it('does not re-judge a resolved state against an irrelevant gap', () => {
    const r = createModeResolver();
    r.apply({ kind: 'osc133', phase: 'output' });
    expect(r.apply({ kind: 'termios', icanon: false, echo: true }).provenance)
      .toBe('authoritative');
    const st = r.apply({ kind: 'sourceUnavailable', source: 'hooks' });
    expect(st.provenance).toBe('authoritative');
    expect(st.degradedReason).toBe('no-hooks');
    // The same declaration DOES land on the next decision hooks bear on.
    expect(r.apply({ kind: 'osc133', phase: 'idle' }).provenance).toBe('degraded');
  });

  // Declaring a gap must mark the CURRENT state degraded too, not only the
  // next hint: the surface reads provenance the moment the declaration lands.
  it('degrades the state that is already resolved, not just later ones', () => {
    const r = createModeResolver();
    const st = r.apply({ kind: 'sourceUnavailable', source: 'hooks' });
    expect(st.provenance).toBe('degraded');
    expect(st.degradedReason).toBe('no-hooks');
  });
});
