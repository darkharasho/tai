/**
 * The debounce that stands between the termios poller and the input surface.
 *
 * Commands like `brew` and `npm` clear ICANON for a couple of poll ticks to
 * draw a progress bar. Committing that reading immediately flips the surface
 * `composer -> docked` and back, so activation waits for the raw-mode state to
 * persist while deactivation is immediate — a real REPL/TUI stays in raw mode
 * indefinitely, and the surface must snap back the moment the child restores
 * canonical mode or exits.
 *
 * It is a unit rather than an inline timer because it is now the single place
 * where a raw-mode reading is *committed*: both the legacy React flag and the
 * mode resolver have to learn about raw mode here, or the resolver ends up
 * acting on transients the rest of the app has already filtered out.
 */

export interface TermiosReading {
  icanon: boolean;
  echo: boolean;
  /** termiosPoller's own mapping: `!icanon`. */
  interactiveProgram: boolean;
}

export interface RawModeGateOptions {
  /** Is raw mode already committed? Mirrors interactiveModeRef in the component. */
  isActive: () => boolean;
  onActivate: (reading: TermiosReading) => void;
  onDeactivate: (reading: TermiosReading) => void;
  /** An option for tests only; production uses the historical 500ms. */
  delayMs?: number;
}

export interface RawModeGate {
  update(reading: TermiosReading): void;
  /** Drop a pending activation without committing it. */
  cancel(): void;
  readonly pending: boolean;
}

export const RAW_MODE_DEBOUNCE_MS = 500;

export function createRawModeGate(opts: RawModeGateOptions): RawModeGate {
  const delay = opts.delayMs ?? RAW_MODE_DEBOUNCE_MS;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function cancel(): void {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  }

  return {
    update(reading: TermiosReading): void {
      if (reading.interactiveProgram) {
        if (opts.isActive() || timer !== null) return;
        timer = setTimeout(() => {
          timer = null;
          opts.onActivate(reading);
        }, delay);
        return;
      }
      cancel();
      opts.onDeactivate(reading);
    },
    cancel,
    get pending() { return timer !== null; },
  };
}
