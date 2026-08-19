import type { ShellHook } from '@/types/shellHooks';

/**
 * Who owns the terminal input right now, and how we know.
 *
 * The bug class this exists to kill: three independent deciders answered "is a
 * raw-mode program running?" with different latencies — a byte regex (instant),
 * an alt-screen escape scan (instant), and termios over IPC (200ms poll plus a
 * 500ms debounce). The results landed in three React flags whose precedence was
 * resolved ad hoc, so on every TUI launch there was a window where they
 * disagreed, and the loser silently discarded PTY output.
 *
 * One reducer, one state, and — critically — the state carries its own
 * provenance so consumers can branch on HOW WE KNOW rather than only on what we
 * know. Dropping bytes is safe under an authoritative signal and reckless under
 * a guess; without provenance there is no way to express that difference.
 */

export type ModeSignal =
  | { kind: 'termios';    icanon: boolean; echo: boolean }   // authoritative
  | { kind: 'altScreen';  entered: boolean }                 // authoritative
  | { kind: 'tuiHint' }                                      // inferred
  | { kind: 'fullscreenHint'; entered: boolean }             // inferred, revocable
  // 'prompt' | 'command' | 'output' are real OSC 133 A/B/C-D markers and are
  // therefore proof that shell integration is alive. 'idle' is SYNTHETIC: it is
  // how a call site reports a command boundary it worked out for itself (the
  // segmenter finishing a block). It carries the same boundary semantics and
  // deliberately none of the proof — see the osc133 case.
  | { kind: 'osc133';     phase: 'prompt' | 'command' | 'output' | 'idle' }
  | { kind: 'hook';       hook: ShellHook }
  | { kind: 'ptyExit' }
  // Degraded is OBSERVED, not assumed. This is the only way a gap enters the
  // resolver: a call site that KNOWS a source cannot report for this context
  // says so once, rather than every downstream consumer re-deriving "are we on
  // Windows / in SSH / without integration?" for itself.
  | { kind: 'sourceUnavailable'; source: 'termios' | 'hooks' };

export type InputOwner = 'shell' | 'program' | 'fullscreen';

/**
 * Ordered, not orthogonal:
 *  - 'authoritative' — from termios or an alt-screen escape.
 *  - 'inferred'      — from a tuiHint, with an authoritative source available
 *                      but not yet heard from.
 *  - 'degraded'      — no authoritative source is available for this context.
 */
export type Provenance = 'authoritative' | 'inferred' | 'degraded';

/** Which authoritative source is missing. Degradation is per-source, never global. */
export type DegradedReason = 'no-hooks' | 'no-termios';

export interface ModeState {
  inputOwner: InputOwner;
  provenance: Provenance;
  degradedReason?: DegradedReason;
  passwordPrompt: boolean;
  commandRunning: boolean;
}

export interface ModeResolver {
  apply(signal: ModeSignal): ModeState;
  readonly state: ModeState;
  reset(): void;
}

export const INITIAL_MODE_STATE: ModeState = {
  inputOwner: 'shell',
  provenance: 'authoritative',
  passwordPrompt: false,
  commandRunning: false,
};

export function createModeResolver(): ModeResolver {
  let state: ModeState = { ...INITIAL_MODE_STATE };
  // Rule 2: a hint is only trusted until an authoritative source speaks for
  // this command. Cleared at every command boundary (rule 4) so the next
  // command's fast path is live again.
  let authoritativeThisCommand = false;
  // Rule 3a: is the current fullscreen claim revocable? A cursor hide is how a
  // full TUI and a cooked spinner both begin, so that claim must yield to a
  // cooked termios reading; a real [?1049h must not.
  //
  // The resets of this flag in the boundary branches below (osc133 prompt, hook
  // precmd, ptyExit) are DEFENSIVE and deliberately untested: the guard that
  // reads it only fires while inputOwner is 'fullscreen', and both signals that
  // can set 'fullscreen' write this flag on the way in, so a stale value is
  // unreachable. They are kept because the flag is a second piece of state that
  // must not survive a lifetime boundary, and a future signal that sets
  // 'fullscreen' without writing it would turn an unreachable bug into a live
  // one. Do not read their survival as coverage.
  let fullscreenRevocable = false;
  // Degraded is OBSERVED, not assumed. We never ask "are we on Windows?" or
  // "are we in SSH?" — we ask whether an authoritative source has reported for
  // the current foreground context. That is what collapses three special cases
  // into one path, and what lets a session self-heal the moment a remote host
  // starts emitting hooks.
  const unavailable = new Set<'termios' | 'hooks'>();

  /**
   * Per-source, never global. A missing termios does not make an alt-screen
   * escape any less of an observation, so a fullscreen decision stays
   * authoritative on Windows while a raw-mode decision does not.
   */
  function degrade(next: ModeState): ModeState {
    if (next.provenance === 'authoritative' && next.inputOwner === 'fullscreen') return next;
    if (unavailable.has('termios')) return { ...next, provenance: 'degraded', degradedReason: 'no-termios' };
    if (unavailable.has('hooks')) return { ...next, provenance: 'degraded', degradedReason: 'no-hooks' };
    return next;
  }

  function set(next: Partial<ModeState>): ModeState {
    state = { ...state, ...next };
    return state;
  }

  function apply(signal: ModeSignal): ModeState {
    switch (signal.kind) {
      case 'termios': {
        authoritativeThisCommand = true;
        // A reading arrived, so termios is not missing after all — however it
        // came to be declared missing. Per-source: this says nothing about
        // hooks, so a 'no-hooks' degradation survives it.
        unavailable.delete('termios');
        // Same mapping the kernel-side poller performs: !ICANON is a raw-mode
        // program, !ECHO with ICANON is the classic password-prompt shape.
        const password = !signal.echo && signal.icanon;
        // Rule 3: an alt-screen takeover is a stronger claim than raw mode and
        // is not revoked by a termios reading — htop is fullscreen AND raw.
        // Rule 3a: a REVOCABLE fullscreen claim (fullscreenHint) survives a raw
        // reading — raw mode corroborates the takeover — but a cooked reading
        // revokes it, which is how a spinner that hid the cursor gets back to
        // the composer. Its provenance stays 'inferred' while it lasts: the
        // reading is authoritative about the line discipline, not about who
        // owns the screen, and retention must not drop bytes on a guess.
        if (state.inputOwner === 'fullscreen' && fullscreenRevocable) {
          if (!signal.icanon) return set({ passwordPrompt: password, degradedReason: undefined });
          fullscreenRevocable = false;
          return set({
            inputOwner: 'shell',
            provenance: 'authoritative',
            passwordPrompt: password,
            degradedReason: undefined,
          });
        }
        const owner: InputOwner = state.inputOwner === 'fullscreen'
          ? 'fullscreen'
          : (!signal.icanon ? 'program' : 'shell');
        return set({
          inputOwner: owner,
          provenance: 'authoritative',
          passwordPrompt: password,
          degradedReason: undefined,
        });
      }

      case 'altScreen': {
        authoritativeThisCommand = true;
        // An observed alt screen upgrades a revocable claim into a real one.
        fullscreenRevocable = false;
        // Leaving the alt screen is authoritative about the SCREEN and about
        // nothing else: a raw-mode program can still own the input, and only
        // termios can say. Without the degrade() a Windows user who quit vim
        // would sit at 'shell:authoritative' for the rest of the session and
        // lose the fallback entirely. Entering is exempted inside degrade().
        return set(degrade({
          ...state,
          inputOwner: signal.entered ? 'fullscreen' : 'shell',
          provenance: 'authoritative',
          degradedReason: undefined,
        }));
      }

      case 'fullscreenHint': {
        if (signal.entered) {
          // Never downgrade an authoritative alt screen into a revocable claim.
          if (state.inputOwner === 'fullscreen' && !fullscreenRevocable) return state;
          fullscreenRevocable = true;
          return set({ inputOwner: 'fullscreen', provenance: 'inferred' });
        }
        if (state.inputOwner !== 'fullscreen' || !fullscreenRevocable) return state;
        fullscreenRevocable = false;
        return set({ inputOwner: 'shell', provenance: 'inferred' });
      }

      case 'tuiHint': {
        // Rule 2: promote only, and only while no authoritative source has
        // spoken for this command.
        if (authoritativeThisCommand) return state;
        if (state.inputOwner !== 'shell') return state;
        return set(degrade({ ...state, inputOwner: 'program', provenance: 'inferred' }));
      }

      case 'osc133': {
        if (signal.phase === 'output' || signal.phase === 'command') {
          unavailable.delete('hooks');
          // A command is starting. Who owns the input from here is exactly the
          // question termios answers, so if termios cannot report, this state
          // is a guess however trustworthy the marker that produced it.
          return set(degrade({ ...state, commandRunning: signal.phase === 'output' }));
        }
        if (signal.phase === 'idle') {
          // Synthetic boundary (the segmenter finished a block). Same shell-is-
          // foreground semantics, but it is NOT evidence that hooks work —
          // treating it as such would let a degraded remote session silently
          // promote itself on the first heuristic prompt match and never
          // degrade again, which would quietly disable this whole feature for
          // the case it exists for.
          authoritativeThisCommand = false;
          fullscreenRevocable = false;
          return set(degrade({
            ...state,
            inputOwner: 'shell',
            provenance: 'authoritative',
            degradedReason: undefined,
            commandRunning: false,
            passwordPrompt: false,
          }));
        }
        // Rule 4: a prompt is proof the foreground is the shell again — and a
        // real OSC 133 marker is itself proof that hooks are working, so it
        // clears a hooks degradation. (A tuiHint proves nothing, which is why
        // that case is routed through degrade() instead.)
        unavailable.delete('hooks');
        authoritativeThisCommand = false;
        fullscreenRevocable = false;
        // `set` spreads over the previous state, so an earlier degradedReason
        // would survive unless it is explicitly cleared here.
        return set({
          inputOwner: 'shell',
          provenance: 'authoritative',
          degradedReason: undefined,
          commandRunning: false,
          passwordPrompt: false,
        });
      }

      case 'hook': {
        // A hook fired, so hooks work. This is the self-heal: a remote host
        // that gains shell integration promotes with no resolver change.
        unavailable.delete('hooks');
        if (signal.hook.hook === 'preexec') {
          // Same reasoning as the OSC 133 command-start branch above.
          return set(degrade({ ...state, commandRunning: true }));
        }
        // precmd — same boundary semantics as an OSC 133 prompt.
        authoritativeThisCommand = false;
        fullscreenRevocable = false;
        return set({
          inputOwner: 'shell',
          provenance: 'authoritative',
          degradedReason: undefined,
          commandRunning: false,
          passwordPrompt: false,
        });
      }

      case 'ptyExit': {
        authoritativeThisCommand = false;
        fullscreenRevocable = false;
        unavailable.clear();
        state = { ...INITIAL_MODE_STATE };
        return state;
      }

      case 'sourceUnavailable': {
        unavailable.add(signal.source);
        // Degrade the state that is already resolved, not only the next
        // decision: the input surface reads provenance the moment this lands.
        return set(degrade(state));
      }
    }
  }

  return {
    apply,
    get state() { return state; },
    reset() {
      state = { ...INITIAL_MODE_STATE };
      authoritativeThisCommand = false;
      fullscreenRevocable = false;
      unavailable.clear();
    },
  };
}
