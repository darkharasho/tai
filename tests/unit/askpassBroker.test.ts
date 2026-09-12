import { describe, it, expect, vi } from 'vitest';
import {
  AskpassBroker, AUTOFILL_HOLD_MS, FILL_SETTLE_MS, type BrokerDeps, type AskpassReply,
} from '../../electron/services/askpassBroker';

const SECRET = 'correct horse';

function makeVault(initial: string | null = null) {
  let s: Buffer | null = initial === null ? null : Buffer.from(initial);
  return {
    isSet: () => s !== null,
    get: vi.fn(() => s),
    set: vi.fn((b: Buffer) => { s = Buffer.from(b); }),
    clear: vi.fn(() => { s = null; }),
  };
}

function setup(opts: { vault?: ReturnType<typeof makeVault>; sudoPid?: (pid: number) => number | null } = {}) {
  let now = 0;
  const timers: Array<{ fn: () => void; due: number; cleared: boolean }> = [];
  const send = vi.fn();
  const vault = opts.vault ?? makeVault();
  let n = 0;
  const deps: BrokerDeps = {
    resolveSudoParent: opts.sudoPid ?? ((pid) => pid + 1000),
    vault,
    send,
    timeoutMs: 300_000,
    autofillHoldMs: AUTOFILL_HOLD_MS,
    setTimer: (fn, ms) => { const t = { fn, due: now + ms, cleared: false }; timers.push(t); return t; },
    clearTimer: (h) => { if (h) (h as { cleared: boolean }).cleared = true; },
    newId: () => `req-${++n}`,
  };
  const broker = new AskpassBroker(deps);
  const request = (pid: number, key = 'tab_1') => {
    const reply = vi.fn<(r: AskpassReply) => void>();
    const cancel = broker.handleRequest({ pid, key, prompt: '[sudo] password for me:' }, reply);
    return { reply, cancel };
  };
  /** Fake clock: move time forward and run every timer now due, in due order. */
  const advance = (ms: number) => {
    const target = now + ms;
    for (;;) {
      const next = timers.filter((t) => !t.cleared && t.due <= target).sort((a, b) => a.due - b.due)[0];
      if (!next) break;
      now = Math.max(now, next.due); // timers scheduled while firing count from their fire time
      next.cleared = true;
      next.fn();
    }
    now = target;
  };
  return { broker, deps, send, vault, request, advance, timers };
}

function messages(send: ReturnType<typeof vi.fn>, key = 'tab_1') {
  return send.mock.calls.filter((c) => c[0] === 'ai:message' && c[1] === key).map((c) => c[2]);
}

describe('AskpassBroker', () => {
  it('refuses immediately when the parent is not sudo, without touching the vault', () => {
    const vault = makeVault(SECRET);
    const { request, send } = setup({ vault, sudoPid: () => null });
    const { reply } = request(42);
    expect(reply).toHaveBeenCalledWith({ ok: false });
    expect(vault.get).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('prompts the renderer when nothing is cached', () => {
    const { request, send } = setup();
    const { reply } = request(42);
    expect(reply).not.toHaveBeenCalled();
    expect(messages(send)).toEqual([{ type: 'sudo_prompt', requestId: 'req-1', prompt: '[sudo] password for me:' }]);
  });

  it('returns an answer to the helper over the socket', () => {
    const { broker, request, send } = setup();
    const { reply } = request(42);
    broker.answer('req-1', SECRET, false);
    expect(reply).toHaveBeenCalledWith({ ok: true, secret: SECRET });
    expect(messages(send)).toContainEqual({ type: 'sudo_resolved', requestId: 'req-1', outcome: 'answered' });
  });

  it('remember stores the secret and broadcasts cache state', () => {
    const { broker, request, vault, send } = setup();
    request(42);
    broker.answer('req-1', SECRET, true);
    expect(vault.set).toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith('pty:secret-state', true);
  });

  it('auto-fills when cached only after the hold, flashes, and never shows a prompt', () => {
    const { request, send, advance } = setup({ vault: makeVault(SECRET) });
    const { reply } = request(42);
    advance(AUTOFILL_HOLD_MS - 1);
    expect(reply).not.toHaveBeenCalled();
    expect(messages(send)).toEqual([]);
    advance(1);
    expect(reply).toHaveBeenCalledWith({ ok: true, secret: SECRET });
    expect(messages(send)).toEqual([{ type: 'sudo_auth' }]);
  });

  it('prompts instead if the cache is cleared during the hold', () => {
    const vault = makeVault(SECRET);
    const { request, send, advance } = setup({ vault });
    const { reply } = request(42);
    vault.clear();
    advance(AUTOFILL_HOLD_MS);
    expect(reply).not.toHaveBeenCalled();
    expect(messages(send).at(-1)).toEqual({ type: 'sudo_prompt', requestId: 'req-1', prompt: '[sudo] password for me:' });
  });

  it('same sudo asking again after an auto-fill: clears cache and prompts', () => {
    const vault = makeVault(SECRET);
    const { request, send, advance } = setup({ vault, sudoPid: () => 900 });
    request(42);                 // auto-fill for sudo 900
    advance(AUTOFILL_HOLD_MS);
    const second = request(43);  // sudo 900 asks again → wrong secret
    advance(AUTOFILL_HOLD_MS);
    expect(second.reply).not.toHaveBeenCalled();
    expect(vault.clear).toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith('pty:secret-state', false);
    expect(messages(send).at(-1)).toEqual({ type: 'sudo_prompt', requestId: 'req-2', prompt: '[sudo] password for me:' });
  });

  it('a different sudo process after an auto-fill auto-fills again once the fill settles', () => {
    const { request, advance } = setup({ vault: makeVault(SECRET) });
    const a = request(42);  // sudo 1042
    advance(AUTOFILL_HOLD_MS);
    const b = request(43);  // sudo 1043
    advance(FILL_SETTLE_MS - 1);
    expect(b.reply).not.toHaveBeenCalled();
    advance(1 + AUTOFILL_HOLD_MS);
    expect(a.reply).toHaveBeenCalledWith({ ok: true, secret: SECRET });
    expect(b.reply).toHaveBeenCalledWith({ ok: true, secret: SECRET });
  });

  it('a remembered answer followed by the same sudo re-asking is rejected, not replayed', () => {
    const vault = makeVault();
    const { broker, request, advance } = setup({ vault, sudoPid: () => 900 });
    request(42);
    broker.answer('req-1', 'typo', true);
    const second = request(43);
    advance(AUTOFILL_HOLD_MS);
    expect(second.reply).not.toHaveBeenCalled();
    expect(vault.clear).toHaveBeenCalled();
  });

  it('queues per key: shows one prompt at a time, remember drains the rest', () => {
    const { broker, request, send, advance } = setup();
    request(42);
    const b = request(43);
    expect(messages(send).filter((m) => m.type === 'sudo_prompt')).toHaveLength(1);
    broker.answer('req-1', SECRET, true);
    advance(FILL_SETTLE_MS + AUTOFILL_HOLD_MS);
    expect(b.reply).toHaveBeenCalledWith({ ok: true, secret: SECRET });
    expect(messages(send).filter((m) => m.type === 'sudo_prompt')).toHaveLength(1);
  });

  it('without remember, the next queued request is prompted', () => {
    const { broker, request, send } = setup();
    request(42);
    request(43);
    broker.answer('req-1', SECRET, false);
    expect(messages(send).filter((m) => m.type === 'sudo_prompt').map((m) => m.requestId)).toEqual(['req-1', 'req-2']);
  });

  it('keys are independent', () => {
    const { request, send } = setup();
    request(42, 'tab_1');
    request(43, 'tab_2');
    expect(messages(send, 'tab_1')).toHaveLength(1);
    expect(messages(send, 'tab_2')).toHaveLength(1);
  });

  it('cancel replies not-ok and resolves the prompt', () => {
    const { broker, request, send } = setup();
    const { reply } = request(42);
    broker.cancel('req-1');
    expect(reply).toHaveBeenCalledWith({ ok: false });
    expect(messages(send)).toContainEqual({ type: 'sudo_resolved', requestId: 'req-1', outcome: 'cancelled' });
  });

  it('the returned canceller (socket closed) cancels', () => {
    const { request } = setup();
    const { reply, cancel } = request(42);
    cancel();
    expect(reply).toHaveBeenCalledWith({ ok: false });
  });

  it('timeout cancels', () => {
    const { request, advance } = setup();
    const { reply } = request(42);
    advance(300_000);
    expect(reply).toHaveBeenCalledWith({ ok: false });
  });

  it('cancelKey cancels only that key; cancelAll cancels everything', () => {
    const { broker, request } = setup();
    const a = request(42, 'tab_1');
    const b = request(43, 'tab_2');
    broker.cancelKey('tab_1');
    expect(a.reply).toHaveBeenCalledWith({ ok: false });
    expect(b.reply).not.toHaveBeenCalled();
    broker.cancelAll();
    expect(b.reply).toHaveBeenCalledWith({ ok: false });
  });

  it('answering an unknown or already-resolved request does nothing', () => {
    const { broker, request } = setup();
    const a = request(42);
    broker.cancel('req-1');
    broker.answer('req-1', SECRET, true);
    broker.answer('nope', SECRET, true);
    expect(a.reply).toHaveBeenCalledTimes(1);
    expect(a.reply).toHaveBeenCalledWith({ ok: false });
  });

  it('clears timers when a request resolves', () => {
    const { broker, request, timers, advance } = setup();
    request(42);
    broker.answer('req-1', SECRET, false);
    advance(FILL_SETTLE_MS);
    expect(timers.every((t) => t.cleared)).toBe(true);
  });

  it('never puts the secret in anything sent to the renderer (auto-fill and answer paths)', () => {
    const vault = makeVault(SECRET);
    const { broker, request, send, advance } = setup({ vault });
    const filled = request(42);          // auto-fill path
    advance(AUTOFILL_HOLD_MS);
    expect(filled.reply).toHaveBeenCalledWith({ ok: true, secret: SECRET });
    vault.clear();
    const prompted = request(43);        // prompt + remembered answer path (req-2)
    broker.answer('req-2', SECRET, true);
    expect(prompted.reply).toHaveBeenCalledWith({ ok: true, secret: SECRET });
    expect(messages(send).map((m) => m.type)).toEqual(['sudo_auth', 'sudo_prompt', 'sudo_resolved']);
    expect(send).toHaveBeenCalledWith('pty:secret-state', true);
    expect(JSON.stringify(send.mock.calls)).not.toContain(SECRET);
  });

  it('the claim cap never evicts a claim that is still pending', () => {
    const { request } = setup();
    const first = request(2, 'tab_first');
    for (let pid = 3; pid < 3 + 1100; pid++) request(pid, `tab_${pid}`);
    const dup = request(2, 'tab_first');
    expect(dup.reply).toHaveBeenCalledWith({ ok: false });
    expect(first.reply).toHaveBeenCalledWith({ ok: false });
  });

  it('interleaved sudo processes: A, B, A rejects A\'s second ask instead of auto-filling it again', () => {
    const vault = makeVault(SECRET);
    const sudoPidFor: Record<number, number> = { 42: 900, 43: 901, 44: 900 };
    const { request, send, advance } = setup({ vault, sudoPid: (pid) => sudoPidFor[pid] });
    const a = request(42);   // sudo A (900) auto-fills
    advance(AUTOFILL_HOLD_MS);
    advance(FILL_SETTLE_MS);
    const b = request(43);  // sudo B (901) auto-fills
    advance(AUTOFILL_HOLD_MS);
    advance(FILL_SETTLE_MS);
    const a2 = request(44); // sudo A (900) asks again: must reject, not auto-fill
    advance(AUTOFILL_HOLD_MS);
    expect(a.reply).toHaveBeenCalledWith({ ok: true, secret: SECRET });
    expect(b.reply).toHaveBeenCalledWith({ ok: true, secret: SECRET });
    expect(a2.reply).not.toHaveBeenCalled();
    expect(vault.clear).toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith('pty:secret-state', false);
    expect(messages(send).at(-1)).toEqual({ type: 'sudo_prompt', requestId: 'req-3', prompt: '[sudo] password for me:' });
  });

  it('cancel during the auto-fill hold clears the hold timer and never replies again', () => {
    const { broker, request, send, advance } = setup({ vault: makeVault(SECRET) });
    const { reply } = request(42);
    broker.cancel('req-1');
    expect(reply).toHaveBeenCalledTimes(1);
    expect(reply).toHaveBeenCalledWith({ ok: false });
    advance(AUTOFILL_HOLD_MS);
    expect(reply).toHaveBeenCalledTimes(1);
    expect(messages(send)).toEqual([]);
  });

  it('cancelKey during the auto-fill hold clears the hold timer and never replies again', () => {
    const { broker, request, send, advance } = setup({ vault: makeVault(SECRET) });
    const { reply } = request(42);
    broker.cancelKey('tab_1');
    expect(reply).toHaveBeenCalledTimes(1);
    expect(reply).toHaveBeenCalledWith({ ok: false });
    advance(AUTOFILL_HOLD_MS);
    expect(reply).toHaveBeenCalledTimes(1);
    expect(messages(send)).toEqual([]);
  });
});

describe('AskpassBroker settle window for parallel sudos (pam_faillock)', () => {
  const sudoPidFor: Record<number, number> = { 42: 900, 43: 901, 44: 902, 45: 900 };
  const sudoPid = (pid: number) => sudoPidFor[pid];
  const gotSecret = (r: ReturnType<typeof vi.fn>) => JSON.stringify(r.mock.calls).includes('"ok":true');

  it('wrong remembered answer: only P gets the secret before its re-ask; B and C never do', () => {
    const vault = makeVault();
    const { broker, request, send, advance } = setup({ vault, sudoPid });
    const a = request(42);
    const b = request(43);
    const c = request(44);
    broker.answer('req-1', 'wrong', true);
    expect(a.reply).toHaveBeenCalledWith({ ok: true, secret: 'wrong' });
    advance(2000);                  // pam_faildelay; B and C must still be waiting
    expect(b.reply).not.toHaveBeenCalled();
    expect(c.reply).not.toHaveBeenCalled();
    expect(messages(send).filter((m) => m.type === 'sudo_prompt')).toHaveLength(1);
    request(45);                    // sudo A re-asks inside the window: reject
    expect(vault.isSet()).toBe(false);
    expect(send).toHaveBeenCalledWith('pty:secret-state', false);
    expect(messages(send).at(-1)).toEqual({ type: 'sudo_prompt', requestId: 'req-4', prompt: '[sudo] password for me:' });
    advance(10 * FILL_SETTLE_MS);
    expect(b.reply).not.toHaveBeenCalled();
    expect(c.reply).not.toHaveBeenCalled();
    expect(JSON.stringify(send.mock.calls)).not.toContain('wrong');
    broker.cancel('req-4');         // B then falls to a prompt, not an auto-fill
    expect(messages(send).at(-1)).toEqual({ type: 'sudo_prompt', requestId: 'req-2', prompt: '[sudo] password for me:' });
    expect(b.reply).not.toHaveBeenCalled();
  });

  it('wrong cached secret: the first auto-fill blocks B and C until its re-ask rejects', () => {
    const vault = makeVault('stale');
    const { request, send, advance } = setup({ vault, sudoPid });
    const a = request(42);
    const b = request(43, 'tab_2');
    const c = request(44, 'tab_3');
    advance(AUTOFILL_HOLD_MS);
    expect(gotSecret(a.reply) || gotSecret(b.reply) || gotSecret(c.reply)).toBe(true);
    const filled = [a, b, c].filter((x) => gotSecret(x.reply));
    expect(filled).toEqual([a]);
    advance(2000);
    request(45);                    // sudo A re-asks
    advance(10 * FILL_SETTLE_MS);
    expect(b.reply).not.toHaveBeenCalled();
    expect(c.reply).not.toHaveBeenCalled();
    expect(messages(send, 'tab_2')).toEqual([{ type: 'sudo_prompt', requestId: 'req-2', prompt: '[sudo] password for me:' }]);
    expect(messages(send, 'tab_3')).toEqual([{ type: 'sudo_prompt', requestId: 'req-3', prompt: '[sudo] password for me:' }]);
  });

  it('correct secret: B and C auto-fill after the window, one settle window apart', () => {
    const vault = makeVault();
    const { broker, request, send, advance } = setup({ vault, sudoPid });
    request(42);
    const b = request(43);
    const c = request(44);
    broker.answer('req-1', SECRET, true);
    advance(FILL_SETTLE_MS - 1);
    expect(b.reply).not.toHaveBeenCalled();
    advance(1 + AUTOFILL_HOLD_MS);
    expect(b.reply).toHaveBeenCalledWith({ ok: true, secret: SECRET });
    expect(c.reply).not.toHaveBeenCalled();
    advance(FILL_SETTLE_MS + AUTOFILL_HOLD_MS);
    expect(c.reply).toHaveBeenCalledWith({ ok: true, secret: SECRET });
    expect(messages(send).filter((m) => m.type === 'sudo_prompt')).toHaveLength(1);
    expect(vault.isSet()).toBe(true);
  });

  it('a hold already running in another key waits if a fill lands first', () => {
    const vault = makeVault();
    const { broker, request, advance } = setup({ vault, sudoPid });
    request(42);                    // tab_1 prompt
    broker.answer('req-1', SECRET, true);
    const b = request(43, 'tab_2');
    advance(AUTOFILL_HOLD_MS);
    expect(b.reply).not.toHaveBeenCalled();
    advance(FILL_SETTLE_MS);
    expect(b.reply).toHaveBeenCalledWith({ ok: true, secret: SECRET });
  });

  it('cancel, cancelKey and cancelAll leave no request or hold timers running; cancelAll clears settle timers', () => {
    const vault = makeVault();
    const { broker, request, advance, timers } = setup({ vault, sudoPid });
    request(42);
    const b = request(43);
    const c = request(44, 'tab_2');
    broker.answer('req-1', SECRET, true);
    broker.cancel('req-2');
    expect(b.reply).toHaveBeenCalledWith({ ok: false });
    broker.cancelKey('tab_2');
    expect(c.reply).toHaveBeenCalledWith({ ok: false });
    expect(timers.filter((t) => !t.cleared)).toHaveLength(1); // only the settle window
    advance(FILL_SETTLE_MS);        // window ends with nothing to resurrect
    expect(b.reply).toHaveBeenCalledTimes(1);
    expect(c.reply).toHaveBeenCalledTimes(1);

    const d = request(43);
    broker.answer('req-4', SECRET, true);
    request(44);                    // queued behind the settle window
    broker.cancelAll();
    expect(d.reply).toHaveBeenCalledTimes(1);
    expect(timers.every((t) => t.cleared)).toBe(true);
  });
});

describe('AskpassBroker single use and duplicate-claim tripwire', () => {
  const refused = (requestId: string) => ({ type: 'sudo_resolved', requestId, outcome: 'refused-duplicate' });

  it('an answered pid is never answered again, and the re-claim trips the wire', () => {
    const vault = makeVault();
    const { broker, request, send, advance } = setup({ vault });
    const first = request(42);
    broker.answer('req-1', SECRET, true);
    const again = request(42);
    advance(10 * AUTOFILL_HOLD_MS);
    expect(first.reply).toHaveBeenCalledTimes(1);
    expect(again.reply).toHaveBeenCalledTimes(1);
    expect(again.reply).toHaveBeenCalledWith({ ok: false });
    expect(vault.clear).toHaveBeenCalled();
    expect(vault.isSet()).toBe(false);
    expect(send).toHaveBeenLastCalledWith('ai:message', 'tab_1', refused('req-1'));
    expect(send).toHaveBeenCalledWith('pty:secret-state', false);
  });

  it('a duplicate while the prompt is shown refuses both and clears the vault', () => {
    const vault = makeVault();
    const { broker, request, send } = setup({ vault });
    const original = request(42);
    const dup = request(42);
    expect(original.reply).toHaveBeenCalledWith({ ok: false });
    expect(dup.reply).toHaveBeenCalledWith({ ok: false });
    expect(vault.clear).toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith('pty:secret-state', false);
    expect(messages(send)).toContainEqual(refused('req-1'));
    broker.answer('req-1', SECRET, false);
    expect(original.reply).toHaveBeenCalledTimes(1);
  });

  it('a duplicate during the auto-fill hold refuses both and the secret never goes out', () => {
    const vault = makeVault(SECRET);
    const { request, send, advance } = setup({ vault });
    const real = request(42);
    advance(AUTOFILL_HOLD_MS - 1);
    const spoof = request(42);
    advance(10 * AUTOFILL_HOLD_MS);
    expect(real.reply).toHaveBeenCalledWith({ ok: false });
    expect(spoof.reply).toHaveBeenCalledWith({ ok: false });
    expect(JSON.stringify([...real.reply.mock.calls, ...spoof.reply.mock.calls])).not.toContain(SECRET);
    expect(vault.isSet()).toBe(false);
    expect(messages(send)).not.toContainEqual({ type: 'sudo_auth' });
    expect(messages(send)).toContainEqual(refused('req-1'));
  });

  it('further claims on a tripped pid keep tripping', () => {
    const vault = makeVault(SECRET);
    const { request, advance } = setup({ vault });
    request(42);
    request(42);
    vault.set(Buffer.from(SECRET));
    const third = request(42);
    advance(10 * AUTOFILL_HOLD_MS);
    expect(third.reply).toHaveBeenCalledWith({ ok: false });
    expect(vault.isSet()).toBe(false);
  });

  it('a cancelled request releases its claim', () => {
    const { broker, request, send, vault } = setup();
    request(42);
    broker.cancel('req-1');
    const retry = request(42);
    expect(retry.reply).not.toHaveBeenCalled();
    expect(vault.clear).not.toHaveBeenCalled();
    expect(messages(send).at(-1)).toEqual({ type: 'sudo_prompt', requestId: 'req-2', prompt: '[sudo] password for me:' });
  });

  it('a recycled pid under a different sudo is not a duplicate', () => {
    let parent = 900;
    const { broker, request, send, vault } = setup({ sudoPid: () => parent });
    request(42);
    broker.answer('req-1', SECRET, false);
    parent = 901;
    const next = request(42);
    expect(next.reply).not.toHaveBeenCalled();
    expect(vault.clear).not.toHaveBeenCalled();
    expect(messages(send).at(-1)).toEqual({ type: 'sudo_prompt', requestId: 'req-2', prompt: '[sudo] password for me:' });
  });

  it('a duplicate claimed from another key warns both keys', () => {
    const { request, send } = setup();
    request(42, 'tab_1');
    request(42, 'tab_2');
    expect(messages(send, 'tab_1')).toContainEqual(refused('req-1'));
    expect(messages(send, 'tab_2')).toEqual([refused('req-1')]);
  });

  it('a duplicate claim on a request that is queued (not head) in its key removes it and refuses it', () => {
    const vault = makeVault();
    const { broker, request, send } = setup({ vault });
    const a = request(10, 'tab_1');  // head, prompt shown immediately (vault empty)
    const b = request(20, 'tab_1');  // stays queued behind a
    expect(messages(send).filter((m) => m.type === 'sudo_prompt')).toEqual([
      { type: 'sudo_prompt', requestId: 'req-1', prompt: '[sudo] password for me:' },
    ]);
    const dup = request(20, 'tab_1'); // duplicate claim on b's pid while b is still queued
    expect(dup.reply).toHaveBeenCalledWith({ ok: false });
    expect(b.reply).toHaveBeenCalledWith({ ok: false });
    expect(vault.clear).toHaveBeenCalled();
    expect(messages(send)).toContainEqual(refused('req-2'));
    expect(a.reply).not.toHaveBeenCalled();
    broker.answer('req-1', SECRET, false);
    expect(a.reply).toHaveBeenCalledWith({ ok: true, secret: SECRET });
  });
});
