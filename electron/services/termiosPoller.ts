export interface TermiosState {
  echo: boolean;
  icanon: boolean;
}

export interface EchoChangeEvent extends TermiosState {
  // !ECHO && ICANON — child program disabled echo while keeping canonical
  // line mode. Classic sudo/ssh password prompt shape.
  passwordPrompt: boolean;
  // !ICANON — child program put the tty into raw mode. Indicates an
  // interactive REPL/TUI (python, node, psql, vim, htop, claude) where
  // every keystroke is delivered immediately and the program manages its
  // own line editing. The card should route input through xterm.
  interactiveProgram: boolean;
}

export type TermiosReader = (fd: number) => TermiosState;
export type ChangeHandler = (e: EchoChangeEvent) => void;

const POLL_INTERVAL_MS = 200;

/**
 * What the tty provably was before the command started: the shell's own
 * canonical mode. Both the initial baseline and resetBaseline() seed from
 * this — they are the same claim ("assume we came from the shell"), and
 * spelling it once keeps them from drifting apart.
 */
const SHELL_STATE: TermiosState = { echo: true, icanon: true };

export class TermiosPoller {
  private _timer: ReturnType<typeof setInterval> | null = null;
  private _last: TermiosState | null = null;

  constructor(
    private _fd: number,
    private _read: TermiosReader,
    private _onChange: ChangeHandler,
  ) {}

  start(): void {
    if (this._timer) return;
    // Seed the baseline with the shell's canonical mode and evaluate at once,
    // rather than snapshotting whatever the tty currently is.
    //
    // A snapshot looks like a "before" reading but is not one: the poller is
    // armed from the OSC 133 output marker, i.e. AFTER the child is already
    // running. A program that goes raw the instant it starts (top, htop, less)
    // has already flipped the tty by the time this runs, so the snapshot baked
    // raw mode into the baseline and every later tick compared equal — the one
    // transition this poller exists to report was the one it could never see,
    // and the surface stayed on the composer while a TUI owned the screen.
    // Programs that print first and go raw later (python, psql) were
    // unaffected, which is why it survived this long.
    //
    // Seeding instead of snapshotting costs nothing in the common case: an
    // ordinary command reads (echo on, canonical), matches the seed, and emits
    // nothing.
    this._last = { ...SHELL_STATE };
    this._tick();
    this._timer = setInterval(() => this._tick(), POLL_INTERVAL_MS);
  }

  stop(): void {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  /**
   * Force the next poll to treat the current tty state as a change. Edge
   * detection misses transitions that collapse inside one poll interval — e.g.
   * chained sudo commands where echo flips off→on→off faster than 200ms, so a
   * real second password prompt is never re-reported. Resetting the baseline to
   * a shell-like (echo on, canonical) state guarantees the next read of a
   * password prompt re-emits onChange.
   */
  resetBaseline(): void {
    this._last = { ...SHELL_STATE };
  }

  private _tick(): void {
    let state: TermiosState;
    try {
      state = this._read(this._fd);
    } catch {
      return;
    }
    if (this._last === null) {
      this._last = state;
      return;
    }
    if (state.echo === this._last.echo && state.icanon === this._last.icanon) {
      return;
    }
    this._last = state;
    this._onChange({
      echo: state.echo,
      icanon: state.icanon,
      passwordPrompt: !state.echo && state.icanon,
      interactiveProgram: !state.icanon,
    });
  }
}

export function defaultTermiosReader(): TermiosReader {
  // Lazy require so test environments without the native module can still load
  // the file and inject a mock reader.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const termios = require('node-termios');
  // node-termios (0.2.x) exposes the local-flag bitmasks on
  // `native.ALL_SYMBOLS` (a flat symbol→value map) and `native.LFLAGS`. There
  // is no `native.constants` — reading that yields `undefined`, so every flag
  // ANDs to 0 and the tty would look permanently raw. Resolve the masks from
  // whichever namespace the build provides.
  const flags = termios.native?.ALL_SYMBOLS ?? termios.native?.LFLAGS ?? termios.native?.constants ?? {};
  const ECHO = flags.ECHO;
  const ICANON = flags.ICANON;
  if (typeof ECHO !== 'number' || typeof ICANON !== 'number') {
    throw new Error('node-termios: could not resolve ECHO/ICANON bitmasks');
  }
  return (fd: number) => {
    const t = new termios.Termios(fd);
    return {
      echo: (t.c_lflag & ECHO) !== 0,
      icanon: (t.c_lflag & ICANON) !== 0,
    };
  };
}
