import { randomUUID } from 'crypto';
import { decideAskpass } from './askpassDecision';

/**
 * How long an auto-fill waits before replying. A client spoofing a helper's pid
 * must connect before or alongside the real helper, so a duplicate claim that
 * lands inside this window trips the wire instead of racing the secret out.
 */
export const AUTOFILL_HOLD_MS = 150;

/** Claims kept for single-use checks; the oldest settled ones are dropped beyond this. */
const MAX_CLAIMS = 1024;

/** Auto-filled sudo pids remembered per key, capped so a long session can't grow this unbounded. */
const MAX_FILLED_PER_KEY = 64;

export interface AskpassRequest {
  pid: number;
  key: string;
  prompt: string;
}

export interface AskpassReply {
  ok: boolean;
  secret?: string;
}

export interface SecretStore {
  isSet(): boolean;
  get(): Buffer | null;
  set(secret: Buffer): void;
  clear(): void;
}

export type SudoOutcome = 'answered' | 'cancelled' | 'refused-duplicate';

export interface BrokerDeps {
  resolveSudoParent(pid: number): number | null;
  vault: SecretStore;
  send(channel: string, ...args: unknown[]): void;
  timeoutMs: number;
  autofillHoldMs?: number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  newId?: () => string;
}

interface Pending {
  id: string;
  key: string;
  pid: number;
  sudoPid: number;
  prompt: string;
  reply: (r: AskpassReply) => void;
  timer: unknown;
  holdTimer: unknown;
  state: 'queued' | 'holding' | 'shown';
}

interface Claim {
  sudoPid: number;
  requestId: string;
  key: string;
}

/**
 * Answers sudo askpass requests from AI tool processes. The secret goes back
 * over the socket, so the only thing standing between it and a lying client is
 * the parent check plus two rules: each helper pid is answered at most once,
 * and any second claim on a pid refuses both claimants and clears the cache.
 * One prompt is visible (or one auto-fill holding) per key at a time; the rest
 * wait in arrival order.
 */
export class AskpassBroker {
  private pending: Pending[] = [];
  /**
   * Per key, every sudo pid that has already been auto-filled (or given a
   * remembered answer) once — not just the most recent one. A wrong cached
   * secret must not be replayed to the *same* sudo process a second time, and
   * that has to hold even when other sudo processes are interleaved in
   * between (A, B, A must reject A's second ask, not auto-fill it again),
   * or Fedora's pam_faillock trips after 3 failures. Capped and FIFO-evicted
   * per key so a long-lived tab can't grow this without bound.
   */
  private lastFilled = new Map<string, number[]>();
  /** Helper pid → the request that claimed it: pending, answered, or burned by a duplicate. */
  private claims = new Map<number, Claim>();

  constructor(private readonly deps: BrokerDeps) {}

  /** Returns a canceller for when the helper's connection drops. */
  handleRequest(req: AskpassRequest, reply: (r: AskpassReply) => void): () => void {
    const sudoPid = this.deps.resolveSudoParent(req.pid);
    if (decideAskpass({ sudoPid, vaultSet: false, lastFilledSudoPid: null }) === 'refuse') {
      reply({ ok: false });
      return () => {};
    }

    const prior = this.claims.get(req.pid);
    // A different sudo parent means the old helper is gone and the pid was
    // recycled; a spoofer claiming a live helper's pid resolves the same sudo.
    if (prior && prior.sudoPid === sudoPid) {
      this.tripDuplicate(prior, req.key, reply);
      return () => {};
    }

    const id = (this.deps.newId ?? randomUUID)();
    const p: Pending = {
      id, key: req.key, pid: req.pid, sudoPid: sudoPid!, prompt: req.prompt, reply,
      timer: null, holdTimer: null, state: 'queued',
    };
    p.timer = this.deps.setTimer(() => this.cancel(id), this.deps.timeoutMs);
    this.pending.push(p);
    // Claim after pushing, so the cap sees this request as pending.
    this.claim(req.pid, { sudoPid: sudoPid!, requestId: id, key: req.key });
    this.pump(req.key);
    return () => this.cancel(id);
  }

  answer(requestId: string, secret: string, remember: boolean): void {
    const p = this.pending.find((x) => x.id === requestId && x.state === 'shown');
    if (!p || typeof secret !== 'string') return;
    if (remember && secret.length > 0) {
      this.deps.vault.set(Buffer.from(secret, 'utf8'));
      // Treat a remembered answer like a fill: if this same sudo asks again the
      // secret was wrong, and it must not be replayed from the cache.
      this.markFilled(p.key, p.sudoPid);
      this.deps.send('pty:secret-state', true);
    }
    this.remove(p);
    p.reply({ ok: true, secret });
    this.deps.send('ai:message', p.key, { type: 'sudo_resolved', requestId: p.id, outcome: 'answered' satisfies SudoOutcome });
    this.pump(p.key);
  }

  cancel(requestId: string): void {
    const p = this.pending.find((x) => x.id === requestId);
    if (!p) return;
    this.dismiss(p);
    this.pump(p.key);
  }

  cancelKey(key: string): void {
    for (const p of this.pending.filter((x) => x.key === key)) this.dismiss(p);
    this.lastFilled.delete(key);
  }

  cancelAll(): void {
    for (const p of [...this.pending]) this.dismiss(p);
  }

  /** Records that `sudoPid` has now had a (possibly wrong) secret replayed to it once, for `key`. */
  private markFilled(key: string, sudoPid: number): void {
    let filled = this.lastFilled.get(key);
    if (!filled) {
      filled = [];
      this.lastFilled.set(key, filled);
    }
    if (!filled.includes(sudoPid)) filled.push(sudoPid);
    // FIFO eviction: bounded per key so a long-lived tab can't grow this without limit.
    while (filled.length > MAX_FILLED_PER_KEY) filled.shift();
  }

  private hasFilled(key: string, sudoPid: number): boolean {
    return this.lastFilled.get(key)?.includes(sudoPid) ?? false;
  }

  private claim(pid: number, c: Claim): void {
    this.claims.delete(pid);
    this.claims.set(pid, c);
    if (this.claims.size <= MAX_CLAIMS) return;
    // Drop the oldest settled claim. A pending claim must stay, or a second
    // claim on its pid would slip past the tripwire.
    const pendingIds = new Set(this.pending.map((x) => x.id));
    for (const [oldPid, old] of this.claims) {
      if (oldPid !== pid && !pendingIds.has(old.requestId)) {
        this.claims.delete(oldPid);
        return;
      }
    }
  }

  /**
   * Two clients claim one helper pid: one of them is impersonating a helper.
   * We cannot tell which, so neither gets anything, the cached secret is
   * dropped, and the user is told. The claim stays burned.
   */
  private tripDuplicate(prior: Claim, newcomerKey: string, reply: (r: AskpassReply) => void): void {
    reply({ ok: false });
    const p = this.pending.find((x) => x.id === prior.requestId);
    if (p) {
      this.remove(p);
      p.reply({ ok: false });
    }
    this.deps.vault.clear();
    this.lastFilled.delete(prior.key);
    this.deps.send('pty:secret-state', false);
    const notice = { type: 'sudo_resolved', requestId: prior.requestId, outcome: 'refused-duplicate' satisfies SudoOutcome };
    this.deps.send('ai:message', prior.key, notice);
    if (newcomerKey !== prior.key) this.deps.send('ai:message', newcomerKey, notice);
    if (p) this.pump(prior.key);
  }

  private dismiss(p: Pending): void {
    this.remove(p);
    // Never answered, so the pid is free again (single use counts answers).
    if (this.claims.get(p.pid)?.requestId === p.id) this.claims.delete(p.pid);
    p.reply({ ok: false });
    if (p.state === 'shown') {
      this.deps.send('ai:message', p.key, { type: 'sudo_resolved', requestId: p.id, outcome: 'cancelled' satisfies SudoOutcome });
    }
  }

  private remove(p: Pending): void {
    this.pending = this.pending.filter((x) => x !== p);
    this.deps.clearTimer(p.timer);
    if (p.holdTimer !== null) {
      this.deps.clearTimer(p.holdTimer);
      p.holdTimer = null;
    }
  }

  private finishAutofill(id: string): void {
    const p = this.pending.find((x) => x.id === id && x.state === 'holding');
    if (!p) return;
    p.holdTimer = null;
    const secret = this.deps.vault.get();
    if (!secret) {
      // Cache cleared during the hold (forgotten, or a reject): ask instead.
      p.state = 'queued';
      this.pump(p.key);
      return;
    }
    this.markFilled(p.key, p.sudoPid);
    this.remove(p);
    p.reply({ ok: true, secret: secret.toString('utf8') });
    this.deps.send('ai:message', p.key, { type: 'sudo_auth' });
    this.pump(p.key);
  }

  private pump(key: string): void {
    const head = this.pending.find((x) => x.key === key);
    if (!head || head.state !== 'queued') return;

    const decision = decideAskpass({
      sudoPid: head.sudoPid,
      vaultSet: this.deps.vault.isSet(),
      lastFilledSudoPid: this.hasFilled(key, head.sudoPid) ? head.sudoPid : null,
    });

    if (decision === 'auto-fill') {
      head.state = 'holding';
      head.holdTimer = this.deps.setTimer(
        () => this.finishAutofill(head.id),
        this.deps.autofillHoldMs ?? AUTOFILL_HOLD_MS,
      );
      return;
    }

    if (decision === 'reject') {
      this.deps.vault.clear();
      this.lastFilled.delete(key);
      this.deps.send('pty:secret-state', false);
    }

    head.state = 'shown';
    this.deps.send('ai:message', key, { type: 'sudo_prompt', requestId: head.id, prompt: head.prompt });
  }
}
