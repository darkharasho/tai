/**
 * What the single bottom input *is* at this moment. One signal drives it:
 * is the foreground process the shell, or a child program?
 *
 *  - composer:   Personality 1 — free shell composer with full TAI smarts.
 *  - tier1:      a line prompt / password — light single-answer input on the
 *                pinned active block.
 *  - docked:     Personality 2 — the live terminal edge (Tier 2: REPLs/ssh),
 *                raw passthrough, block grows upward, pinned to the bottom.
 *  - rooted:     a long-running session (dev server, watcher, promoted
 *                long-runner) — the composer morphs into the session card.
 *                The card lives IN the scrollback (one continuous scroll
 *                with history, auto-following), stdin line inside it, no
 *                xterm (cooked-mode output stays on the HTML path).
 *  - fullscreen: Tier 3 — a full TUI takes over its own surface (alt-screen).
 */
export type InputSurface = 'composer' | 'tier1' | 'docked' | 'rooted' | 'fullscreen';

export interface InteractiveSignals {
  altScreenVisible: boolean;
  /** A raw-mode child program is foreground (termios poll: e.interactiveProgram). */
  interactiveMode: boolean;
  /** Only meaningful when interactiveMode is true (a fullscreen raw-mode program). */
  interactiveFullscreen: boolean;
  /** A cooked, line-at-a-time read() is blocking. */
  awaitingInput: boolean;
  passwordPrompt: boolean;
  /** The active block is a long-running session (see sessionKind.shouldRootSession). */
  rootedSession?: boolean;
  /** Windows fallback inputs. Windows (ConPTY) has no termios and no /proc, so
   *  none of the interactivity signals above can be detected. When `isWindows`
   *  is set and a command is running, we fall back to the live terminal so the
   *  user can still type into a program that's waiting for input. */
  isWindows?: boolean;
  /** A command is currently executing in the foreground (not the idle shell). */
  commandRunning?: boolean;
}

export function deriveInputSurface(s: InteractiveSignals): InputSurface {
  // Single-answer prompts take precedence: they can co-occur with interactiveMode
  // (the password path also flips interactiveMode) but need the light line input.
  if (s.passwordPrompt || s.awaitingInput) return 'tier1';
  if (s.altScreenVisible || (s.interactiveMode && s.interactiveFullscreen)) return 'fullscreen';
  if (s.interactiveMode) return 'docked';
  // Termios signals outrank rooting: a server that drops to raw mode or asks
  // a cooked question gets the richer surface for that moment.
  if (s.rootedSession) return 'rooted';
  // Windows has no termios / /proc, so the signals above never fire. Any
  // running command might be waiting for input, so fall back to the live
  // terminal (docked) — a plain-terminal experience — instead of stranding the
  // user on the composer with no way to type into the foreground program.
  if (s.isWindows && s.commandRunning) return 'docked';
  return 'composer';
}

export function focusTargetFor(surface: InputSurface): 'composer' | 'cardInput' | 'xterm' {
  if (surface === 'composer') return 'composer';
  if (surface === 'tier1' || surface === 'rooted') return 'cardInput';
  return 'xterm';
}

/** The standalone bottom composer renders only in the free-composer surface. */
export function composerVisible(surface: InputSurface): boolean {
  return surface === 'composer';
}

/**
 * The active interactive block is pinned to the bottom region (not in scroll).
 * `rooted` deliberately stays IN the scrollback: a detached pinned card with
 * its own inner scrollbar made session output feel severed from history.
 */
export function pinnedActiveBlock(surface: InputSurface): boolean {
  return surface === 'docked' || surface === 'tier1';
}

/**
 * The real terminal (xterm) renders only for `docked` (portaled into the pinned
 * block) and `fullscreen` (takeover). It must NOT render for `tier1`: password
 * and line prompts use light widgets, and a live xterm would steal their focus
 * and keystrokes (the masked dots never update). `rooted` keeps the cheap HTML
 * streaming path — its stdin line writes to the PTY directly. `composer`
 * never shows it.
 */
export function shouldShowXterm(surface: InputSurface): boolean {
  return surface === 'docked' || surface === 'fullscreen';
}
