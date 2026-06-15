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
    // Capture the baseline synchronously so the very first interval tick can
    // already report a change — otherwise the first tick is burned snapshotting
    // the shell's canonical mode and detection lags a full interval.
    try {
      this._last = this._read(this._fd);
    } catch {
      this._last = null;
    }
    this._timer = setInterval(() => this._tick(), POLL_INTERVAL_MS);
  }

  stop(): void {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
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
