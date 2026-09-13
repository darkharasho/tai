/** Return to column 0 and clear the line: wipes the prompt the echo sat on. */
export const ERASE_LINE = '\r\x1b[2K';

/** Held bytes beyond the echo itself before the filter gives up. */
const MAX_EXTRA = 4096;

/**
 * Bash loads TAI's integration from a line typed into the PTY, and readline
 * echoes it back after the first prompt. The renderer's block view already
 * hides that line, but the live xterm draws the raw stream. This removes the
 * echo from the stream itself: once armed with the exact typed command, output
 * is held until the echo and its newline arrive, then everything but the echo
 * is released with the prompt line cleared so the real prompt redraws cleanly.
 * Anything unexpected releases the held bytes unchanged.
 */
export class BootstrapEchoFilter {
  private cmd: string | null = null;
  private held = '';

  get armed(): boolean {
    return this.cmd !== null;
  }

  /** `cmd` is the injected line without its trailing newline. */
  arm(cmd: string): void {
    this.cmd = cmd;
    this.held = '';
  }

  process(data: string): string {
    if (this.cmd === null) return data;
    this.held += data;

    const at = this.held.indexOf(this.cmd);
    if (at >= 0) {
      const rest = this.held.slice(at + this.cmd.length);
      const eol = /^\r*\n/.exec(rest);
      if (eol) {
        const out = this.held.slice(0, at) + ERASE_LINE + rest.slice(eol[0].length);
        this.disarm();
        return out;
      }
      if (/^\r*$/.test(rest)) return '';
      // Echo followed by something other than a newline: not ours.
      return this.flush();
    }

    return this.held.length > this.cmd.length + MAX_EXTRA ? this.flush() : '';
  }

  /** Releases whatever is held and stops filtering. */
  flush(): string {
    const out = this.held;
    this.disarm();
    return out;
  }

  private disarm(): void {
    this.cmd = null;
    this.held = '';
  }
}
