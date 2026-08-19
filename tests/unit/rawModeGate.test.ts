import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRawModeGate, type TermiosReading } from '@/utils/rawModeGate';

const raw: TermiosReading = { icanon: false, echo: true, interactiveProgram: true };
const cooked: TermiosReading = { icanon: true, echo: true, interactiveProgram: false };

function harness(active = { value: false }) {
  const activated: TermiosReading[] = [];
  const deactivated: TermiosReading[] = [];
  const gate = createRawModeGate({
    isActive: () => active.value,
    onActivate: r => { active.value = true; activated.push(r); },
    onDeactivate: r => { active.value = false; deactivated.push(r); },
  });
  return { gate, activated, deactivated, active };
}

describe('createRawModeGate', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('commits activation only after the raw-mode reading persists', () => {
    const { gate, activated } = harness();
    gate.update(raw);
    expect(activated).toEqual([]);
    vi.advanceTimersByTime(499);
    expect(activated).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(activated).toEqual([raw]);
  });

  it('swallows a transient ICANON drop entirely', () => {
    // `brew`/`npm` clear ICANON for a progress bar for a couple of poll ticks.
    // Nothing may be committed for that — not the flag, and not the resolver.
    const { gate, activated, deactivated } = harness();
    gate.update(raw);
    vi.advanceTimersByTime(200);
    gate.update(cooked);
    vi.advanceTimersByTime(5000);
    expect(activated).toEqual([]);
    expect(deactivated).toEqual([cooked]);
  });

  it('does not re-arm while a pending activation is already scheduled', () => {
    const { gate, activated } = harness();
    gate.update(raw);
    vi.advanceTimersByTime(400);
    gate.update(raw);
    vi.advanceTimersByTime(100);
    expect(activated).toEqual([raw]);
    vi.advanceTimersByTime(5000);
    expect(activated).toEqual([raw]);
  });

  it('does not schedule when raw mode is already committed', () => {
    const { gate, activated } = harness({ value: true });
    gate.update(raw);
    vi.advanceTimersByTime(5000);
    expect(activated).toEqual([]);
  });

  it('commits deactivation immediately', () => {
    const { gate, deactivated } = harness({ value: true });
    gate.update(cooked);
    expect(deactivated).toEqual([cooked]);
  });

  it('cancel() drops a pending activation', () => {
    const { gate, activated } = harness();
    gate.update(raw);
    gate.cancel();
    vi.advanceTimersByTime(5000);
    expect(activated).toEqual([]);
  });
});
