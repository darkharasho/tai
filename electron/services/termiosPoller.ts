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

const POLL_INTERVAL_MS = 1000;

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
    this._last = null;
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
  return (fd: number) => {
    const t = new termios.Termios(fd);
    return {
      echo: (t.c_lflag & termios.native.constants.ECHO) !== 0,
      icanon: (t.c_lflag & termios.native.constants.ICANON) !== 0,
    };
  };
}
