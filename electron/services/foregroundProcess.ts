import * as fs from 'fs';

export type Foreground = 'sudo' | 'other' | 'unknown';

export interface ForegroundInfo {
  kind: Foreground;
  /** The controlling tty's foreground process-group id, or null if unresolved.
   *  Identifies WHICH sudo process is prompting — same tpgid re-prompting means
   *  our auto-filled secret was rejected; a different tpgid is a new command. */
  tpgid: number | null;
  /**
   * Is the shell's OWN process group the tty's foreground group — i.e. no child
   * is running and the shell is sitting at its line editor?
   *
   * Only ever true when /proc answered; an unresolved read reports false, so a
   * caller that suppresses on this suppresses nothing when it cannot tell.
   */
  shellIsForeground: boolean;
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
    if (closeParenIdx < 0) return { kind: 'unknown', tpgid: null, shellIsForeground: false };
    const fields = stat.slice(closeParenIdx + 2).split(' ');
    // Post-comm stat fields: 0 state, 1 ppid, 2 pgrp, 3 session, 4 tty_nr, 5 tpgid.
    const pgrp = parseInt(fields[2], 10);
    const tpgid = parseInt(fields[5], 10);
    if (!(tpgid > 0)) return { kind: 'unknown', tpgid: null, shellIsForeground: false };
    const shellIsForeground = pgrp > 0 && pgrp === tpgid;
    const comm = readFile(`/proc/${tpgid}/comm`).trim();
    if (!comm) return { kind: 'unknown', tpgid, shellIsForeground };
    return { kind: comm === 'sudo' ? 'sudo' : 'other', tpgid, shellIsForeground };
  } catch {
    return { kind: 'unknown', tpgid: null, shellIsForeground: false };
  }
}

/** Convenience wrapper returning just the classification (sudo / other / unknown). */
export function resolveForeground(
  shellPid: number,
  readFile: (path: string) => string = defaultReadFile,
): Foreground {
  return resolveForegroundDetail(shellPid, readFile).kind;
}
