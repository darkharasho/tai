import { describe, it, expect } from 'vitest';
import {
  shouldOfferRemoteIntegration,
  isRemoteRawSession,
  isKnownUnintegrated,
  rememberRemoteProbe,
} from '@/utils/remoteIntegration';
import { createModeResolver } from '@/utils/terminalMode';

const OFFER = { target: 'picomp@picomp.local' };

describe('shouldOfferRemoteIntegration', () => {
  it('offers once checkRemote reported no integration and hooks are missing', () => {
    expect(shouldOfferRemoteIntegration({ offer: OFFER, hooksGap: true })).toBe(true);
  });

  it('stays silent before the host has been asked', () => {
    expect(shouldOfferRemoteIntegration({ offer: null, hooksGap: true })).toBe(false);
  });

  it('withdraws itself when hooks start arriving (self-heal, no dismissal)', () => {
    expect(shouldOfferRemoteIntegration({ offer: OFFER, hooksGap: false })).toBe(false);
  });
});

describe('shouldOfferRemoteIntegration — the two regressions', () => {
  // The old guard was `!showXterm && card && degradedReason === 'no-hooks'`.
  // Both extra terms are gone; these pin them out.

  it('offers while the xterm is docked — an ssh session is raw-mode the whole way through', () => {
    // There is no showXterm input to pass. That is the fix: the offer does not
    // depend on where the input surface happens to be. If a `showXterm`-shaped
    // parameter ever reappears here, this test's absence of one is the reason.
    expect(shouldOfferRemoteIntegration({ offer: OFFER, hooksGap: true })).toBe(true);
  });

  it('offers even when a termios gap is also open', () => {
    const r = createModeResolver();
    r.apply({ kind: 'sourceUnavailable', source: 'termios' });
    const state = r.apply({ kind: 'sourceUnavailable', source: 'hooks' });

    // degradedReason reports only the higher-priority gap...
    expect(state.degradedReason).toBe('no-termios');
    // ...but the hooks gap is genuinely open, and that is what the offer reads.
    expect(state.hooksGap).toBe(true);
    expect(shouldOfferRemoteIntegration({ offer: OFFER, hooksGap: state.hooksGap })).toBe(true);
  });
});

describe('ModeState.hooksGap', () => {
  it('is closed on a fresh resolver', () => {
    expect(createModeResolver().state.hooksGap).toBe(false);
  });

  it('opens on an observed hooks gap and closes when a hook arrives', () => {
    const r = createModeResolver();
    expect(r.apply({ kind: 'sourceUnavailable', source: 'hooks' }).hooksGap).toBe(true);
    expect(r.apply({ kind: 'hook', hook: { hook: 'precmd', exit: 0, signal: null, duration_ms: 5, command: 'ls', cwd: '/home/pi' } }).hooksGap).toBe(false);
  });

  it('is not closed by a termios reading — the gap is per-source', () => {
    const r = createModeResolver();
    r.apply({ kind: 'sourceUnavailable', source: 'hooks' });
    expect(r.apply({ kind: 'termios', icanon: true, echo: true }).hooksGap).toBe(true);
  });

  it('clears on reset', () => {
    const r = createModeResolver();
    r.apply({ kind: 'sourceUnavailable', source: 'hooks' });
    r.reset();
    expect(r.state.hooksGap).toBe(false);
  });
});

describe('isRemoteRawSession', () => {
  it('is true for an ssh session on a host with no hooks', () => {
    expect(isRemoteRawSession({ sshActive: true, hooksGap: true })).toBe(true);
  });

  it('is false on an integrated host — that session still gets block chrome', () => {
    expect(isRemoteRawSession({ sshActive: false, hooksGap: true })).toBe(false);
    expect(isRemoteRawSession({ sshActive: true, hooksGap: false })).toBe(false);
  });

  // Self-heal, same as the offer: install integration mid-session and the first
  // hook closes the gap, so the takeover gives the pane back to the block UI.
  it('releases the takeover once hooks start arriving', () => {
    expect(isRemoteRawSession({ sshActive: true, hooksGap: false })).toBe(false);
  });
});

describe('remembered probe verdicts', () => {
  const store = () => {
    const m = new Map<string, string>();
    return {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => { m.set(k, v); },
      removeItem: (k: string) => { m.delete(k); },
      size: () => m.size,
    };
  };

  it('knows nothing about a host it has never probed', () => {
    expect(isKnownUnintegrated('picomp@picomp.local', store())).toBe(false);
  });

  it('remembers a host that answered "no integration here"', () => {
    const s = store();
    rememberRemoteProbe('picomp@picomp.local', { installed: false, reachable: true }, s);
    expect(isKnownUnintegrated('picomp@picomp.local', s)).toBe(true);
  });

  it('keeps hosts separate', () => {
    const s = store();
    rememberRemoteProbe('picomp@picomp.local', { installed: false, reachable: true }, s);
    expect(isKnownUnintegrated('piclock@piclock.local', s)).toBe(false);
  });

  // The whole point of the `reachable` flag. checkRemote probes with
  // BatchMode=yes, so a host that wants a password or passphrase fails the
  // probe while being perfectly well integrated. Treating that as "missing"
  // for the session is the existing (revocable) behaviour; burning it into
  // the cache would make a wrong guess permanent.
  it('refuses to record a verdict the probe never earned', () => {
    const s = store();
    rememberRemoteProbe('picomp@picomp.local', { installed: false, reachable: false }, s);
    expect(isKnownUnintegrated('picomp@picomp.local', s)).toBe(false);
    expect(s.size()).toBe(0);
  });

  it('leaves an earlier verdict alone when a later probe cannot connect', () => {
    const s = store();
    rememberRemoteProbe('picomp@picomp.local', { installed: false, reachable: true }, s);
    rememberRemoteProbe('picomp@picomp.local', { installed: false, reachable: false }, s);
    expect(isKnownUnintegrated('picomp@picomp.local', s)).toBe(true);
  });

  // Install integration and the next connect must not flash the takeover up
  // and then hand the pane back when the first hook arrives.
  it('forgets a host once integration turns up on it', () => {
    const s = store();
    rememberRemoteProbe('picomp@picomp.local', { installed: false, reachable: true }, s);
    rememberRemoteProbe('picomp@picomp.local', { installed: true, reachable: true }, s);
    expect(isKnownUnintegrated('picomp@picomp.local', s)).toBe(false);
  });

  it('survives a storage that throws (private mode, quota)', () => {
    const dead = {
      getItem: () => { throw new Error('nope'); },
      setItem: () => { throw new Error('nope'); },
      removeItem: () => { throw new Error('nope'); },
    };
    expect(isKnownUnintegrated('picomp@picomp.local', dead)).toBe(false);
    expect(() => rememberRemoteProbe('picomp@picomp.local', { installed: false, reachable: true }, dead)).not.toThrow();
  });
});
