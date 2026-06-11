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
});

describe('rooted surface helpers', () => {
  it('hides the composer, pins the block, focuses the card input, no xterm', () => {
    expect(composerVisible('rooted')).toBe(false);
    expect(pinnedActiveBlock('rooted')).toBe(true);
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
