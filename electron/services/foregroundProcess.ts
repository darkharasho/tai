import * as fs from 'fs';

export type Foreground = 'sudo' | 'other' | 'unknown';

export interface ForegroundInfo {
  kind: Foreground;
  /** The controlling tty's foreground process-group id, or null if unresolved.
   *  Identifies WHICH sudo process is prompting — same tpgid re-prompting means
   *  our auto-filled secret was rejected; a different tpgid is a new command. */
  tpgid: number | null;
}

function defaultReadFile(path: string): string {
  return fs.readFileSync(path, 'utf8');
}

/**
 * Resolve the foreground process of the shell's controlling terminal, using
 * only `/proc`. `tpgid` (the controlling tty's foreground process-group id)
 * lives in the shell's stat line; its leader's `comm` is the program waiting on
 * the tty (e.g. `sudo`). Any failure resolves to `{ kind: 'unknown', tpgid:
 * null }` so callers fail safe (treat as not-sudo).
 */
export function resolveForegroundDetail(
  shellPid: number,
  readFile: (path: string) => string = defaultReadFile,
): ForegroundInfo {
  try {
    const stat = readFile(`/proc/${shellPid}/stat`);
    // comm is parenthesized and may contain spaces/parens — skip to the last ')'.
    const closeParenIdx = stat.lastIndexOf(')');
    if (closeParenIdx < 0) return { kind: 'unknown', tpgid: null };
    const fields = stat.slice(closeParenIdx + 2).split(' ');
    const tpgid = parseInt(fields[5], 10);
    if (!(tpgid > 0)) return { kind: 'unknown', tpgid: null };
    const comm = readFile(`/proc/${tpgid}/comm`).trim();
    if (!comm) return { kind: 'unknown', tpgid };
    return { kind: comm === 'sudo' ? 'sudo' : 'other', tpgid };
  } catch {
    return { kind: 'unknown', tpgid: null };
  }
}

/** Convenience wrapper returning just the classification (sudo / other / unknown). */
export function resolveForeground(
  shellPid: number,
  readFile: (path: string) => string = defaultReadFile,
): Foreground {
  return resolveForegroundDetail(shellPid, readFile).kind;
}
