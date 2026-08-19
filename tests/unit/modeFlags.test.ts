import { describe, it, expect } from 'vitest';
import { inputSignalsFromMode, sameModeState } from '@/utils/modeFlags';
import { INITIAL_MODE_STATE, type ModeState } from '@/utils/terminalMode';
import { deriveInputSurface } from '@/utils/inputSurface';

function state(patch: Partial<ModeState>): ModeState {
  return { ...INITIAL_MODE_STATE, ...patch };
}

function surfaceFor(mode: ModeState) {
  return deriveInputSurface({
    ...inputSignalsFromMode(mode),
    awaitingInput: false,
    passwordPrompt: false,
  });
}

describe('inputSignalsFromMode', () => {
  // Every case asserts the exact triple AND the surface it produces. The triple
  // alone would pass with the fields permuted; the surface alone would pass with
  // a redundant field dropped. Together they pin each field individually — which
  // is what makes replacing any of them with a constant a test failure rather
  // than a silent production outage.
  it('leaves the composer alone while the shell owns the input', () => {
    expect(inputSignalsFromMode(state({ inputOwner: 'shell' }))).toEqual({
      altScreenVisible: false,
      interactiveMode: false,
      interactiveFullscreen: false,
    });
    expect(surfaceFor(state({ inputOwner: 'shell' }))).toBe('composer');
  });

  it('docks a raw-mode program without claiming the whole screen', () => {
    expect(inputSignalsFromMode(state({ inputOwner: 'program' }))).toEqual({
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
    expect(inputSignalsFromMode(state({ inputOwner: 'fullscreen' }))).toEqual({
      altScreenVisible: true,
      interactiveMode: true,
      interactiveFullscreen: true,
    });
    expect(surfaceFor(state({ inputOwner: 'fullscreen' }))).toBe('fullscreen');
  });

  it('ignores provenance — how we know does not change what is rendered', () => {
    // A revocable fullscreenHint renders identically to a real alt screen. The
    // difference is what may DROP bytes (Task 9), not what is shown.
    expect(inputSignalsFromMode(state({ inputOwner: 'fullscreen', provenance: 'inferred' })))
      .toEqual(inputSignalsFromMode(state({ inputOwner: 'fullscreen', provenance: 'authoritative' })));
    expect(inputSignalsFromMode(state({ inputOwner: 'program', provenance: 'inferred' })))
      .toEqual(inputSignalsFromMode(state({ inputOwner: 'program', provenance: 'authoritative' })));
  });

  it('maps every owner to a distinct surface', () => {
    // The whole-domain sweep: three owners, three surfaces, no collisions. A
    // constant-valued field collapses two of these onto one surface.
    expect((['shell', 'program', 'fullscreen'] as const).map(o => surfaceFor(state({ inputOwner: o }))))
      .toEqual(['composer', 'docked', 'fullscreen']);
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
