import { describe, it, expect } from 'vitest';
import { legacyFlagsFromMode, sameModeState } from '@/utils/modeFlags';
import { INITIAL_MODE_STATE, type ModeState } from '@/utils/terminalMode';
import { deriveInputSurface } from '@/utils/inputSurface';

function state(patch: Partial<ModeState>): ModeState {
  return { ...INITIAL_MODE_STATE, ...patch };
}

function surfaceFor(mode: ModeState) {
  return deriveInputSurface({
    ...legacyFlagsFromMode(mode),
    awaitingInput: false,
    passwordPrompt: false,
  });
}

describe('legacyFlagsFromMode', () => {
  it('leaves the composer alone while the shell owns the input', () => {
    expect(legacyFlagsFromMode(state({ inputOwner: 'shell' }))).toEqual({
      altScreenVisible: false,
      interactiveMode: false,
      interactiveFullscreen: false,
    });
    expect(surfaceFor(state({ inputOwner: 'shell' }))).toBe('composer');
  });

  it('docks a raw-mode program without claiming the whole screen', () => {
    expect(legacyFlagsFromMode(state({ inputOwner: 'program' }))).toEqual({
      altScreenVisible: false,
      interactiveMode: true,
      interactiveFullscreen: false,
    });
    expect(surfaceFor(state({ inputOwner: 'program' }))).toBe('docked');
  });

  it('gives a fullscreen program both fullscreen routes', () => {
    // deriveInputSurface reaches 'fullscreen' either by altScreenVisible or by
    // interactiveMode && interactiveFullscreen. Both are set on purpose: this
    // is the mapping that keeps vim and htop off the composer, and dropping
    // either half silently downgrades the surface or leaves a stale flag.
    expect(legacyFlagsFromMode(state({ inputOwner: 'fullscreen' }))).toEqual({
      altScreenVisible: true,
      interactiveMode: true,
      interactiveFullscreen: true,
    });
    expect(surfaceFor(state({ inputOwner: 'fullscreen' }))).toBe('fullscreen');
  });

  it('ignores provenance — how we know does not change what is rendered', () => {
    expect(legacyFlagsFromMode(state({ inputOwner: 'program', provenance: 'inferred' })))
      .toEqual(legacyFlagsFromMode(state({ inputOwner: 'program', provenance: 'authoritative' })));
  });
});

describe('sameModeState', () => {
  it('is true for a fresh object carrying the same answer', () => {
    expect(sameModeState(state({ inputOwner: 'program' }), state({ inputOwner: 'program' }))).toBe(true);
  });

  it('is false for every field the flags or the consumers read', () => {
    const base = state({ inputOwner: 'program' });
    expect(sameModeState(base, state({ inputOwner: 'fullscreen' }))).toBe(false);
    expect(sameModeState(base, { ...base, provenance: 'inferred' })).toBe(false);
    expect(sameModeState(base, { ...base, degradedReason: 'no-termios' })).toBe(false);
    expect(sameModeState(base, { ...base, passwordPrompt: true })).toBe(false);
    expect(sameModeState(base, { ...base, commandRunning: true })).toBe(false);
  });
});
