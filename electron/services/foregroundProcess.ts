import * as fs from 'fs';

export type Foreground = 'sudo' | 'other' | 'unknown';

function defaultReadFile(path: string): string {
  return fs.readFileSync(path, 'utf8');
}

/**
 * Resolve whether the foreground process of the shell's controlling terminal
 * is `sudo`, using only `/proc`. `tpgid` (the controlling tty's foreground
 * process-group id) lives in the shell's stat line; its leader's `comm` is the
 * program waiting on the tty (e.g. `sudo`). Any failure resolves to 'unknown'
 * so callers fail safe (treat as not-sudo).
 */
export function resolveForeground(
  shellPid: number,
  readFile: (path: string) => string = defaultReadFile,
): Foreground {
  try {
    const stat = readFile(`/proc/${shellPid}/stat`);
    // comm is parenthesized and may contain spaces/parens — skip to the last ')'.
    const closeParenIdx = stat.lastIndexOf(')');
    if (closeParenIdx < 0) return 'unknown';
    const fields = stat.slice(closeParenIdx + 2).split(' ');
    const tpgid = parseInt(fields[5], 10);
    if (!(tpgid > 0)) return 'unknown';
    const comm = readFile(`/proc/${tpgid}/comm`).trim();
    if (!comm) return 'unknown';
    return comm === 'sudo' ? 'sudo' : 'other';
  } catch {
    return 'unknown';
  }
}
