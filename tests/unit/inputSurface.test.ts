import { describe, it, expect } from 'vitest';
import {
  deriveInputSurface,
  focusTargetFor,
  composerVisible,
  pinnedActiveBlock,
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
});
