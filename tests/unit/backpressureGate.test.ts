import { describe, it, expect, vi } from 'vitest';
import { createBackpressureGate } from '../../electron/services/backpressureGate';

describe('backpressureGate', () => {
  function makeGate(opts?: { high?: number; low?: number }) {
    const pause = vi.fn();
    const resume = vi.fn();
    const gate = createBackpressureGate({
      high: opts?.high ?? 100,
      low: opts?.low ?? 50,
      pause,
      resume,
    });
    return { gate, pause, resume };
  }

  it('does not pause below high-water', () => {
    const { gate, pause } = makeGate();
    gate.onSent(99);
    expect(pause).not.toHaveBeenCalled();
  });

  it('pauses when crossing high-water', () => {
    const { gate, pause } = makeGate();
    gate.onSent(100);
    expect(pause).toHaveBeenCalledTimes(1);
  });

  it('does not pause twice', () => {
    const { gate, pause } = makeGate();
    gate.onSent(120);
    gate.onSent(50);
    expect(pause).toHaveBeenCalledTimes(1);
  });

  it('resumes when ACKs bring outstanding to or below low-water', () => {
    const { gate, pause, resume } = makeGate();
    gate.onSent(120);
    expect(pause).toHaveBeenCalledTimes(1);
    gate.onAck(70); // outstanding = 50, == low
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it('does not resume when still above low-water', () => {
    const { gate, resume } = makeGate();
    gate.onSent(120);
    gate.onAck(20); // outstanding = 100, > low
    expect(resume).not.toHaveBeenCalled();
  });

  it('does not resume when never paused', () => {
    const { gate, resume } = makeGate();
    gate.onSent(40);
    gate.onAck(40);
    expect(resume).not.toHaveBeenCalled();
  });

  it('handles overshoot ACK as zero outstanding (no negative)', () => {
    const { gate, pause, resume } = makeGate();
    gate.onSent(120);
    gate.onAck(1000);
    expect(resume).toHaveBeenCalledTimes(1);
    // Subsequent sends start fresh at 0.
    gate.onSent(99);
    expect(pause).toHaveBeenCalledTimes(1); // not called again
  });
});
