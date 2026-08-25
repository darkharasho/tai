import { ipcMain } from 'electron';
import { execFileSync } from 'node:child_process';

export type BranchExec = (cwd: string) => string;

const defaultExec: BranchExec = (cwd: string) =>
  execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
    cwd,
    encoding: 'utf8',
    timeout: 1000,
    stdio: ['ignore', 'pipe', 'ignore'],
  });

/** Resolve the current git branch for `cwd`, or null if none/detached. */
export function resolveGitBranch(cwd: string, exec: BranchExec = defaultExec): string | null {
  try {
    const out = exec(cwd).trim();
    if (!out || out === 'HEAD') return null;
    return out;
  } catch {
    return null;
  }
}

export interface GitStatus {
  branch: string | null;
  /** Entries git reports as changed: staged, unstaged and untracked alike. */
  dirty: number;
}

export type StatusExec = (cwd: string) => string;

const defaultStatusExec: StatusExec = (cwd: string) =>
  execFileSync(
    'git',
    // porcelain=v2 is the documented stable machine format, and --branch folds
    // the branch name into the same invocation so the chip never shows a
    // branch and a dirty count read a moment apart from each other.
    ['status', '--porcelain=v2', '--branch', '--untracked-files=normal'],
    { cwd, encoding: 'utf8', timeout: 1500, stdio: ['ignore', 'pipe', 'ignore'] },
  );

/**
 * Parse `git status --porcelain=v2 --branch` into the two facts the composer
 * chip needs. Header lines start with '#'; every other non-empty line is one
 * changed path, whatever the change was.
 */
export function parseGitStatus(out: string): GitStatus {
  let branch: string | null = null;
  let dirty = 0;
  for (const line of out.split('\n')) {
    if (!line) continue;
    if (line.startsWith('# branch.head ')) {
      const head = line.slice('# branch.head '.length).trim();
      // v2 spells a detached HEAD "(detached)"; treat it as no branch, the way
      // resolveGitBranch treats the "HEAD" that v1 reports.
      if (head && head !== '(detached)') branch = head;
      continue;
    }
    if (line.startsWith('#')) continue;
    dirty++;
  }
  return { branch, dirty };
}

export function resolveGitStatus(cwd: string, exec: StatusExec = defaultStatusExec): GitStatus {
  try {
    return parseGitStatus(exec(cwd));
  } catch {
    // Not a repository, git missing, or the call timed out — the chip simply
    // does not render, which is the same thing it does outside a repo.
    return { branch: null, dirty: 0 };
  }
}

/** How long a status reading stays fresh. Only wide enough to collapse the
 *  burst of requests a single command finalizing produces — dirty state
 *  changes on every file save, so this cannot be cached the way a branch
 *  name is. */
export const STATUS_TTL_MS = 2000;

export function setupGitService(now: () => number = Date.now): void {
  const cache = new Map<string, string | null>();
  ipcMain.handle('git:branch', (_event, cwd: string) => {
    if (!cwd) return null;
    if (cache.has(cwd)) return cache.get(cwd) ?? null;
    if (cache.size > 64) cache.clear();
    const branch = resolveGitBranch(cwd);
    cache.set(cwd, branch);
    return branch;
  });

  const statusCache = new Map<string, { at: number; value: GitStatus }>();
  ipcMain.handle('git:status', (_event, cwd: string): GitStatus => {
    if (!cwd) return { branch: null, dirty: 0 };
    const t = now();
    const hit = statusCache.get(cwd);
    if (hit && t - hit.at < STATUS_TTL_MS) return hit.value;
    if (statusCache.size > 64) statusCache.clear();
    const value = resolveGitStatus(cwd);
    statusCache.set(cwd, { at: t, value });
    return value;
  });
}
