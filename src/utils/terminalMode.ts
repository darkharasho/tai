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

/** The authoritative sources a decision can depend on. */
type ModeSourceName = 'termios' | 'hooks';

export interface ModeState {
  inputOwner: InputOwner;
  provenance: Provenance;
  degradedReason?: DegradedReason;
  /**
   * Is the `hooks` source specifically still missing?
   *
   * `degradedReason` cannot answer this: it reports ONE gap and prefers
   * 'no-termios', so a session that also lacks termios reports 'no-termios'
   * while the hooks gap stays wide open. Consumers that care about shell
   * integration in particular — not about degradation in general — read this.
   */
  hooksGap: boolean;
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
  hooksGap: false,
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
  const unavailable = new Set<ModeSourceName>();

  // Which sources could authoritatively answer the question the CURRENT state
  // answers. Relevance is per-DECISION, not per-session: "who owns the input"
  // is termios's question and a missing hooks source says nothing about it,
  // while "is a command running / are we back at a prompt" is a question hooks
  // answer and a synthesized boundary is a guess without them. Tracked as state
  // because `sourceUnavailable` has to re-judge the state already resolved, and
  // the question that state answered is not recoverable from the state itself.
  const OWNERSHIP: readonly ModeSourceName[] = ['termios'];
  const BOUNDARY: readonly ModeSourceName[] = ['termios', 'hooks'];
  // The initial state is a boundary claim: a prompt, nothing running.
  let deciders: readonly ModeSourceName[] = BOUNDARY;

  /**
   * Per-source, never global. A missing termios does not make an alt-screen
   * escape any less of an observation, so a fullscreen decision stays
   * authoritative on Windows while a raw-mode decision does not — and a missing
   * hooks source does not make a termios reading any less of an observation,
   * which is why this consults only the sources relevant to `sources`.
   */
  function degrade(next: ModeState, sources: readonly ModeSourceName[]): ModeState {
    deciders = sources;
    if (next.provenance === 'authoritative' && next.inputOwner === 'fullscreen') return next;
    if (!sources.some(s => unavailable.has(s))) return next;
    return { ...next, provenance: 'degraded' };
  }

  /**
   * The open gap, if any. DERIVED on every write rather than stored and cleared
   * by whichever branch happened to run: a termios reading used to blank a
   * still-open 'hooks' gap, so the field flapped to undefined and back on the
   * next signal while the `unavailable` set never changed. Both live consumers
   * read it directly, and both silently turned off for that interval.
   *
   * It is deliberately independent of `provenance`. `provenance` is about the
   * decision just made; this is about the session, and a state can truthfully
   * be authoritative about raw mode while shell integration is still missing.
   */
  function openGap(): DegradedReason | undefined {
    if (unavailable.has('termios')) return 'no-termios';
    if (unavailable.has('hooks')) return 'no-hooks';
    return undefined;
  }

  function set(next: Partial<ModeState>): ModeState {
    state = { ...state, ...next, degradedReason: openGap(), hooksGap: unavailable.has('hooks') };
    return state;
  }

  function apply(signal: ModeSignal): ModeState {
    switch (signal.kind) {
      case 'termios': {
        authoritativeThisCommand = true;
        // A line-discipline reading. Only termios could contradict it.
        deciders = OWNERSHIP;
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
          if (!signal.icanon) return set({ passwordPrompt: password });
          fullscreenRevocable = false;
          return set({
            inputOwner: 'shell',
            provenance: 'authoritative',
            passwordPrompt: password,
          });
        }
        const owner: InputOwner = state.inputOwner === 'fullscreen'
          ? 'fullscreen'
          : (!signal.icanon ? 'program' : 'shell');
        return set({
          inputOwner: owner,
          provenance: 'authoritative',
          passwordPrompt: password,
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
        }, OWNERSHIP));
      }

      case 'fullscreenHint': {
        if (signal.entered) {
          // Never downgrade an authoritative alt screen into a revocable claim.
          if (state.inputOwner === 'fullscreen' && !fullscreenRevocable) return state;
          fullscreenRevocable = true;
          deciders = OWNERSHIP;
          return set({ inputOwner: 'fullscreen', provenance: 'inferred' });
        }
        if (state.inputOwner !== 'fullscreen' || !fullscreenRevocable) return state;
        fullscreenRevocable = false;
        deciders = OWNERSHIP;
        return set({ inputOwner: 'shell', provenance: 'inferred' });
      }

      case 'tuiHint': {
        // Rule 2: promote only, and only while no authoritative source has
        // spoken for this command.
        if (authoritativeThisCommand) return state;
        if (state.inputOwner !== 'shell') return state;
        // A raw-mode claim. termios is the source that settles it; a missing
        // hooks source is irrelevant to it and used to degrade it anyway.
        return set(degrade({ ...state, inputOwner: 'program', provenance: 'inferred' }, OWNERSHIP));
      }

      case 'osc133': {
        if (signal.phase === 'output' || signal.phase === 'command') {
          unavailable.delete('hooks');
          // A command is starting. Who owns the input from here is exactly the
          // question termios answers, so if termios cannot report, this state
          // is a guess however trustworthy the marker that produced it.
          return set(degrade({ ...state, commandRunning: signal.phase === 'output' }, OWNERSHIP));
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
          // The one decision hooks are the authority for: a real boundary
          // marker is exactly what this is standing in for, so without hooks
          // this claim is a guess — however good the heuristic behind it.
          return set(degrade({
            ...state,
            inputOwner: 'shell',
            provenance: 'authoritative',
            commandRunning: false,
            passwordPrompt: false,
          }, BOUNDARY));
        }
        // Rule 4: a prompt is proof the foreground is the shell again — and a
        // real OSC 133 marker is itself proof that hooks are working, so it
        // clears a hooks degradation. (A tuiHint proves nothing, which is why
        // that case is routed through degrade() instead.)
        unavailable.delete('hooks');
        authoritativeThisCommand = false;
        fullscreenRevocable = false;
        deciders = BOUNDARY;
        return set({
          inputOwner: 'shell',
          provenance: 'authoritative',
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
          return set(degrade({ ...state, commandRunning: true }, OWNERSHIP));
        }
        // precmd — same boundary semantics as an OSC 133 prompt.
        authoritativeThisCommand = false;
        fullscreenRevocable = false;
        deciders = BOUNDARY;
        return set({
          inputOwner: 'shell',
          provenance: 'authoritative',
          commandRunning: false,
          passwordPrompt: false,
        });
      }

      case 'ptyExit': {
        authoritativeThisCommand = false;
        fullscreenRevocable = false;
        deciders = BOUNDARY;
        unavailable.clear();
        state = { ...INITIAL_MODE_STATE };
        return state;
      }

      case 'sourceUnavailable': {
        unavailable.add(signal.source);
        // Degrade the state that is already resolved, not only the next
        // decision: the input surface reads provenance the moment this lands.
        // Judged against the question the current state answered — declaring
        // hooks missing does not retroactively make a termios reading a guess.
        return set(degrade(state, deciders));
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
      deciders = BOUNDARY;
      unavailable.clear();
    },
  };
}
