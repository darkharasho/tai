/**
 * What the single bottom input *is* at this moment. One signal drives it:
 * is the foreground process the shell, or a child program?
 *
 *  - composer:   Personality 1 — free shell composer with full TAI smarts.
 *  - tier1:      a line prompt / password — light single-answer input on the
 *                pinned active block.
 *  - docked:     Personality 2 — the live terminal edge (Tier 2: REPLs/ssh),
 *                raw passthrough, block grows upward, pinned to the bottom.
 *  - fullscreen: Tier 3 — a full TUI takes over its own surface (alt-screen).
 */
export type InputSurface = 'composer' | 'tier1' | 'docked' | 'fullscreen';

export interface InteractiveSignals {
  altScreenVisible: boolean;
  /** A raw-mode child program is foreground (termios poll: e.interactiveProgram). */
  interactiveMode: boolean;
  /** Only meaningful when interactiveMode is true (a fullscreen raw-mode program). */
  interactiveFullscreen: boolean;
  /** A cooked, line-at-a-time read() is blocking. */
  awaitingInput: boolean;
  passwordPrompt: boolean;
}

export function deriveInputSurface(s: InteractiveSignals): InputSurface {
  // Single-answer prompts take precedence: they can co-occur with interactiveMode
  // (the password path also flips interactiveMode) but need the light line input.
  if (s.passwordPrompt || s.awaitingInput) return 'tier1';
  if (s.altScreenVisible || (s.interactiveMode && s.interactiveFullscreen)) return 'fullscreen';
  if (s.interactiveMode) return 'docked';
  return 'composer';
}

export function focusTargetFor(surface: InputSurface): 'composer' | 'cardInput' | 'xterm' {
  if (surface === 'composer') return 'composer';
  if (surface === 'tier1') return 'cardInput';
  return 'xterm';
}

/** The standalone bottom composer renders only in the free-composer surface. */
export function composerVisible(surface: InputSurface): boolean {
  return surface === 'composer';
}

/** The active interactive block is pinned to the bottom region (not in scroll). */
export function pinnedActiveBlock(surface: InputSurface): boolean {
  return surface === 'docked' || surface === 'tier1';
}
