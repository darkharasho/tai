export interface BackpressureGateOptions {
  high: number;
  low: number;
  pause: () => void;
  resume: () => void;
}

export interface BackpressureGate {
  onSent(bytes: number): void;
  onAck(bytes: number): void;
}

export function createBackpressureGate(opts: BackpressureGateOptions): BackpressureGate {
  let outstanding = 0;
  let paused = false;

  return {
    onSent(bytes: number) {
      outstanding += bytes;
      if (!paused && outstanding >= opts.high) {
        paused = true;
        opts.pause();
      }
    },
    onAck(bytes: number) {
      outstanding -= bytes;
      if (outstanding < 0) outstanding = 0;
      if (paused && outstanding <= opts.low) {
        paused = false;
        opts.resume();
      }
    },
  };
}
