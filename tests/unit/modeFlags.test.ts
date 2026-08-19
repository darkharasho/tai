import { describe, it, expect } from 'vitest';
import { sameModeState } from '@/utils/modeFlags';
import { INITIAL_MODE_STATE, type ModeState } from '@/utils/terminalMode';

function state(patch: Partial<ModeState>): ModeState {
  return { ...INITIAL_MODE_STATE, ...patch };
}

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
