import { describe, it, expect } from 'vitest';
import {
  deriveInputSurface,
  focusTargetFor,
  composerVisible,
  pinnedActiveBlock,
  shouldShowXterm,
  type InteractiveSignals,
} from '../../src/utils/inputSurface';

const base: InteractiveSignals = {
  altScreenVisible: false,
  interactiveMode: false,
  interactiveFullscreen: false,
  awaitingInput: false,
  passwordPrompt: false,
};

describe('deriveInputSurface', () => {
  it('is the free composer when the shell is foreground', () => {
    expect(deriveInputSurface(base)).toBe('composer');
  });

  it('is tier1 for a password prompt (highest precedence)', () => {
    expect(deriveInputSurface({ ...base, passwordPrompt: true, interactiveMode: true })).toBe('tier1');
  });

  it('is tier1 for a cooked line read', () => {
    expect(deriveInputSurface({ ...base, awaitingInput: true })).toBe('tier1');
  });

  it('is fullscreen for an alt-screen TUI', () => {
    expect(deriveInputSurface({ ...base, altScreenVisible: true })).toBe('fullscreen');
  });

  it('is fullscreen for a raw-mode fullscreen program', () => {
    expect(deriveInputSurface({ ...base, interactiveMode: true, interactiveFullscreen: true })).toBe('fullscreen');
  });

  it('is docked for a raw-mode REPL/ssh (Tier 2)', () => {
    expect(deriveInputSurface({ ...base, interactiveMode: true })).toBe('docked');
  });

  it('ignores interactiveFullscreen without interactiveMode (invariant: it implies interactiveMode)', () => {
    expect(deriveInputSurface({ ...base, interactiveFullscreen: true })).toBe('composer');
  });

  it('is rooted for a long-running session (server/watch) with the shell otherwise quiet', () => {
    expect(deriveInputSurface({ ...base, rootedSession: true })).toBe('rooted');
  });

  it('lets raw-mode and prompts outrank rooted', () => {
    expect(deriveInputSurface({ ...base, rootedSession: true, interactiveMode: true })).toBe('docked');
    expect(deriveInputSurface({ ...base, rootedSession: true, passwordPrompt: true })).toBe('tier1');
    expect(deriveInputSurface({ ...base, rootedSession: true, altScreenVisible: true })).toBe('fullscreen');
  });

  // Was the `isWindows` special case (Task 10). Windows (ConPTY) has no termios
  // and no /proc, so the interactivity signals above never fire — but neither
  // do they for an SSH session with no remote hooks or a shell with no
  // integration. The input is now the resolver's provenance, so all three take
  // this one path. Without it the surface is stuck on `composer` and a running
  // command that waits for input hangs with nowhere to type.
  it('falls back to docked whenever nothing authoritative is reporting', () => {
    expect(deriveInputSurface({
      altScreenVisible: false, interactiveMode: false, interactiveFullscreen: false,
      awaitingInput: false, passwordPrompt: false,
      degraded: true, commandRunning: true,
    })).toBe('docked');
  });

  it('stays on the composer when degraded but nothing is running', () => {
    expect(deriveInputSurface({
      altScreenVisible: false, interactiveMode: false, interactiveFullscreen: false,
      awaitingInput: false, passwordPrompt: false,
      degraded: true, commandRunning: false,
    })).toBe('composer');
  });

  it('never applies while an authoritative source is reporting', () => {
    expect(deriveInputSurface({ ...base, degraded: false, commandRunning: true })).toBe('composer');
  });

  it('is outranked by rooted sessions and real prompts', () => {
    expect(deriveInputSurface({ ...base, degraded: true, commandRunning: true, rootedSession: true })).toBe('rooted');
    expect(deriveInputSurface({ ...base, degraded: true, commandRunning: true, passwordPrompt: true })).toBe('tier1');
    expect(deriveInputSurface({ ...base, degraded: true, commandRunning: true, altScreenVisible: true })).toBe('fullscreen');
  });
});

describe('rooted surface helpers', () => {
  it('hides the composer, keeps the block in the scrollback, focuses the card input, no xterm', () => {
    expect(composerVisible('rooted')).toBe(false);
    // Rooted sessions live IN the scrolling history — one continuous scroll —
    // rather than a detached bottom-pinned region.
    expect(pinnedActiveBlock('rooted')).toBe(false);
    expect(focusTargetFor('rooted')).toBe('cardInput');
    expect(shouldShowXterm('rooted')).toBe(false);
  });
});

describe('focusTargetFor', () => {
  it('maps each surface to its owning element', () => {
    expect(focusTargetFor('composer')).toBe('composer');
    expect(focusTargetFor('tier1')).toBe('cardInput');
    expect(focusTargetFor('docked')).toBe('xterm');
    expect(focusTargetFor('fullscreen')).toBe('xterm');
  });
});

describe('predicates', () => {
  it('shows the standalone composer only in the composer surface', () => {
    expect(composerVisible('composer')).toBe(true);
    expect(composerVisible('docked')).toBe(false);
    expect(composerVisible('tier1')).toBe(false);
    expect(composerVisible('fullscreen')).toBe(false);
  });

  it('pins the active block for docked and tier1, not fullscreen/composer', () => {
    expect(pinnedActiveBlock('docked')).toBe(true);
    expect(pinnedActiveBlock('tier1')).toBe(true);
    expect(pinnedActiveBlock('fullscreen')).toBe(false);
    expect(pinnedActiveBlock('composer')).toBe(false);
  });

  it('shows the xterm only for docked and fullscreen, never tier1/composer', () => {
    // tier1 (password / line prompt) uses light widgets; if the xterm rendered
    // it would steal focus from the PasswordPrompt and the masked dots would
    // never update. composer never shows the xterm either.
    expect(shouldShowXterm('docked')).toBe(true);
    expect(shouldShowXterm('fullscreen')).toBe(true);
    expect(shouldShowXterm('tier1')).toBe(false);
    expect(shouldShowXterm('composer')).toBe(false);
  });
});

describe('deriveInputSurface — raw ssh takeover', () => {
  const RAW = {
    altScreenVisible: false,
    interactiveMode: true,
    interactiveFullscreen: false,
    awaitingInput: false,
    passwordPrompt: false,
  };

  // The regression this fixes: an un-integrated ssh docked into a pinned card
  // capped at 76vh, wrapping an xterm with min-height 72vh plus card padding, a
  // header and a notice strip — the remote prompt ended up below the region's
  // bottom edge with nothing to scroll.
  it('takes over the pane for an ssh host with no shell integration', () => {
    expect(deriveInputSurface({ ...RAW, remoteRaw: true })).toBe('fullscreen');
  });

  it('still docks a raw-mode program on an integrated host', () => {
    expect(deriveInputSurface({ ...RAW, remoteRaw: false })).toBe('docked');
    expect(deriveInputSurface(RAW)).toBe('docked');
  });

  // A password or line prompt outranks the takeover: those need the light
  // tier1 widget, and a live xterm over them steals their keystrokes.
  it('yields to a single-answer prompt', () => {
    expect(deriveInputSurface({ ...RAW, remoteRaw: true, passwordPrompt: true })).toBe('tier1');
    expect(deriveInputSurface({ ...RAW, remoteRaw: true, awaitingInput: true })).toBe('tier1');
  });

  // Was: 'does not take over when no program is in the foreground'.
  //
  // interactiveMode is a termios inference about who owns the tty at this
  // instant. It is the wrong gate for the takeover, and this is the bug it
  // caused: run htop inside an un-integrated ssh, press q, and the alt-screen
  // exit resolves inputOwner to 'shell' (terminalMode's altScreen branch is
  // authoritative about the SCREEN only). interactiveMode goes false, the
  // takeover is released mid-session, and it never returns — the termios poller
  // is edge-triggered and the local tty is STILL raw, byte-identical to before,
  // so no event ever fires again. The user was left in the block UI with the
  // ssh block's stdin CardInput floating under a live remote prompt.
  //
  // Whether a child program is foreground says nothing about whether ssh is
  // still live. remoteRaw already knows that independently (sshActive is
  // bracketed by the LOCAL shell's OSC 133 frame), so it stands alone.
  it('holds the takeover after a TUI inside the session exits', () => {
    expect(deriveInputSurface({ ...RAW, interactiveMode: false, remoteRaw: true })).toBe('fullscreen');
  });

  it('holds it through the alt-screen enter/exit cycle without a termios event', () => {
    const ssh = { ...RAW, remoteRaw: true };
    expect(deriveInputSurface(ssh)).toBe('fullscreen');
    // htop up
    expect(deriveInputSurface({ ...ssh, altScreenVisible: true, interactiveFullscreen: true })).toBe('fullscreen');
    // q — alt screen gone, inputOwner back to 'shell', no termios edge
    expect(deriveInputSurface({ ...ssh, interactiveMode: false })).toBe('fullscreen');
  });

  it('releases it when the ssh session itself ends', () => {
    expect(deriveInputSurface({ ...RAW, interactiveMode: false, remoteRaw: false })).toBe('composer');
  });
});
