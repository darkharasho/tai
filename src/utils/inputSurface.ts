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
 *  - fullscreen: Tier 3 — takeover. A full TUI (alt-screen) or a raw ssh
 *                session with no remote hooks gets the whole session pane:
 *                scrollback history is not rendered while it is up. TAI cannot
 *                parse what is on that surface, so it does not frame it.
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
  /** No authoritative source is available for this context — see terminalMode's
   *  provenance. Formerly the Windows special case; Windows (ConPTY) has no
   *  termios and no /proc, but so does an SSH session with no remote hooks, and
   *  so does a shell with no integration. All three are the same situation and
   *  now take the same path. */
  degraded?: boolean;
  /** A command is currently executing in the foreground (not the idle shell). */
  commandRunning?: boolean;
  /** An ssh session on a host with no shell integration — see
   *  remoteIntegration's isRemoteRawSession. Every byte is passthrough, so
   *  there is no block structure for a card to display. */
  remoteRaw?: boolean;
}

export function deriveInputSurface(s: InteractiveSignals): InputSurface {
  // Single-answer prompts take precedence: they can co-occur with interactiveMode
  // (the password path also flips interactiveMode) but need the light line input.
  if (s.passwordPrompt || s.awaitingInput) return 'tier1';
  if (s.altScreenVisible || (s.interactiveMode && s.interactiveFullscreen)) return 'fullscreen';
  // A raw ssh session takes over too. It is not alt-screen, but it is just as
  // opaque: no hooks means no boundaries, no exit codes, nothing to put in a
  // card. Below the alt-screen rung only for tidiness — both land here.
  //
  // Deliberately NOT gated on interactiveMode. That gate is what made quitting
  // htop inside an un-integrated ssh drop the takeover for the rest of the
  // session: the alt-screen exit is authoritative about the screen only, so it
  // resolves inputOwner to 'shell' and clears interactiveMode, and no termios
  // event ever restores it because the local tty never left raw mode (the
  // poller is edge-triggered, and ssh's state is byte-identical to htop's).
  // remoteRaw is the honest signal here: it is bracketed by the LOCAL shell's
  // OSC 133 frame, so it is true for exactly as long as ssh is live and says
  // nothing about which child happens to be foreground inside it.
  if (s.remoteRaw) return 'fullscreen';
  if (s.interactiveMode) return 'docked';
  // Termios signals outrank rooting: a server that drops to raw mode or asks
  // a cooked question gets the richer surface for that moment.
  if (s.rootedSession) return 'rooted';
  // Nothing authoritative is reporting, so any running command might be waiting
  // for input. Fall back to the live terminal instead of stranding the user on
  // the composer with no way to type into the foreground program.
  if (s.degraded && s.commandRunning) return 'docked';
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
