/**
 * Should we offer to install shell integration on the remote host?
 *
 * This lived for two months as an inline JSX condition and silently stopped
 * being true. It is a function with tests now for exactly that reason.
 *
 * Two regressions are baked into the shape of the inputs:
 *
 *  1. The old guard included `!showXterm`. An interactive ssh puts the local
 *     tty in raw mode, so termios reports `inputOwner: 'program'`, the surface
 *     resolves to 'docked', and `shouldShowXterm` is true for the WHOLE
 *     session — permanently falsifying the guard in precisely the scenario the
 *     offer exists for. Where the offer renders is a layout question; it is not
 *     an input to whether the offer applies, and it is absent here.
 *
 *  2. The old guard included `degradedReason === 'no-hooks'`. That field
 *     reports one gap and prefers 'no-termios', so any session that also
 *     declared a termios gap suppressed the offer. The per-source `hooksGap`
 *     is what that guard was reaching for.
 *
 * What remains is the actual claim: we have asked this host (`offer` is set
 * only after `checkRemote` answered `installed: false`) and hooks are still
 * missing. The second term is not redundant — it is the self-heal. If the
 * host starts emitting OSC 133 the resolver closes the gap and the offer
 * withdraws itself, no dismissal needed.
 */
export interface RemoteIntegrationOffer {
  target: string;
}

export interface RemoteIntegrationSignals {
  /** Set only once `checkRemote(target)` has reported no integration. */
  offer: RemoteIntegrationOffer | null;
  /** The `hooks` source is still unavailable for this session. */
  hooksGap: boolean;
}

export function shouldOfferRemoteIntegration(s: RemoteIntegrationSignals): boolean {
  return !!s.offer && s.hooksGap;
}

/**
 * Is this a live ssh session on a host that never sends OSC 133?
 *
 * Such a session is raw passthrough end to end: TAI cannot see command
 * boundaries, exit codes, or the prompt, so there is nothing for it to frame.
 * Docking it into a block card produced the worst of both — card padding, a
 * header and a notice strip eating vertical space above an xterm that then ran
 * off the bottom of the pinned region, with no way to scroll to the prompt
 * because that region is `overflow: hidden` and xterm owns its own scrollback.
 *
 * NOT `eff.isRemote` — that tracks whether the remote-AI pill is switched on,
 * which is a different question with a confusingly similar name.
 */
export function isRemoteRawSession(s: { sshActive: boolean; hooksGap: boolean }): boolean {
  return s.sshActive && s.hooksGap;
}

/**
 * What a `checkRemote` probe actually established.
 *
 * `installed` and `reachable` are separate because the probe connects with
 * `BatchMode=yes`: a host that wants a password or a passphrase fails it
 * outright, indistinguishably from a host that answered "no files here". For
 * the current session that conflation is harmless — treating an unreachable
 * host as un-integrated is revocable, and the first real hook undoes it — but
 * it must never be written down. See `rememberRemoteProbe`.
 */
export interface RemoteProbeResult {
  installed: boolean;
  reachable: boolean;
}

/** The slice of localStorage this module uses. Narrowed so tests can fake it. */
export interface ProbeStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const PROBE_KEY = (target: string) => `tai:si:probe:${target}`;

/**
 * Has this host already told us, to our face, that it has no integration?
 *
 * Used to declare the hooks gap the instant an ssh block opens, rather than
 * after a round trip. That is an inference about THIS session drawn from a
 * previous one, which cuts against the resolver's authority-over-inference
 * grain — it is acceptable only because it is revocable in the right
 * direction: if the host has gained integration since, its first OSC 133 hook
 * closes the gap and hands the pane straight back to the block UI.
 */
export function isKnownUnintegrated(target: string, store: ProbeStore): boolean {
  try {
    return store.getItem(PROBE_KEY(target)) === 'missing';
  } catch {
    // Storage can be unavailable (private mode, disabled cookies). Knowing
    // nothing is the safe answer: it costs a probe, never a wrong takeover.
    return false;
  }
}

/**
 * Write down a probe verdict — but only one the probe genuinely earned.
 *
 * An unreachable host records nothing at all, deliberately leaving any earlier
 * verdict intact: "I could not ask" is not evidence, and the alternative is
 * burning a password-auth host in as permanently un-integrated.
 */
export function rememberRemoteProbe(target: string, result: RemoteProbeResult, store: ProbeStore): void {
  if (!result.reachable) return;
  try {
    if (result.installed) store.removeItem(PROBE_KEY(target));
    else store.setItem(PROBE_KEY(target), 'missing');
  } catch {
    // Nothing to do — the cache is an optimisation, not state we depend on.
  }
}
