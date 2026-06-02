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

export function setupGitService(): void {
  const cache = new Map<string, string | null>();
  ipcMain.handle('git:branch', (_event, cwd: string) => {
    if (!cwd) return null;
    if (cache.has(cwd)) return cache.get(cwd) ?? null;
    if (cache.size > 64) cache.clear();
    const branch = resolveGitBranch(cwd);
    cache.set(cwd, branch);
    return branch;
  });
}
