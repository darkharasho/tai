import { describe, it, expect } from 'vitest';
import { askpassEnvFor, cancelAskpassForKey, stopAskpassService } from '../../electron/services/askpassService';

describe('askpassService before setup', () => {
  it('provides no env and tolerates cancel/stop', () => {
    expect(askpassEnvFor('tab_1')).toEqual({});
    expect(() => cancelAskpassForKey('tab_1')).not.toThrow();
    expect(() => stopAskpassService()).not.toThrow();
  });

  it('never leaks the askpass vars into process.env, which terminal PTYs inherit', () => {
    // pty.ts builds each shell's env from `{ ...process.env }`, so keeping
    // process.env clean is what keeps the terminal unaffected.
    // Compare against the starting values: the suite may itself run under a
    // TAI AI tool, whose env legitimately carries both vars.
    const before = { SUDO_ASKPASS: process.env.SUDO_ASKPASS, TAI_ASKPASS_KEY: process.env.TAI_ASKPASS_KEY };
    askpassEnvFor('tab_1');
    cancelAskpassForKey('tab_1');
    expect({ SUDO_ASKPASS: process.env.SUDO_ASKPASS, TAI_ASKPASS_KEY: process.env.TAI_ASKPASS_KEY }).toEqual(before);
  });
});
