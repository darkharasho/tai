import { ipcMain } from 'electron';
import { readdirSync } from 'node:fs';
import { delimiter } from 'node:path';

/**
 * Every executable name on PATH, for the classifier's weakest rung.
 *
 * Entries are NOT stat'ed for the executable bit. There are ~4000 of them on a
 * stock box, and spending 4000 syscalls to slightly narrow the bottom rung of a
 * cascade is not a trade worth making — a false positive there costs a
 * confidence upgrade at most.
 */

export type ReadDir = (dir: string) => string[];

/** Ceiling on the IPC payload; far above any real PATH. */
export const MAX_BINARIES = 20000;

const defaultRead: ReadDir = (dir) =>
  readdirSync(dir, { withFileTypes: true })
    .filter(e => !e.isDirectory())
    .map(e => e.name);

export function scanPathBinaries(pathVar: string, read: ReadDir = defaultRead): string[] {
  const out = new Set<string>();
  for (const dir of pathVar.split(delimiter)) {
    if (!dir) continue;
    if (out.size >= MAX_BINARIES) break;
    try {
      for (const name of read(dir)) out.add(name);
    } catch {
      // Missing or permission-denied directories on PATH are ordinary.
    }
  }
  return [...out].slice(0, MAX_BINARIES);
}

export function setupPathBinariesService(): void {
  let cachedFor: string | null = null;
  let cached: string[] = [];
  ipcMain.handle('shell:pathBinaries', () => {
    const pathVar = process.env.PATH ?? '';
    // Keyed on PATH itself, so a shell that exports a new one is picked up on
    // the next request rather than being stale for the life of the app.
    if (pathVar !== cachedFor) {
      cached = scanPathBinaries(pathVar);
      cachedFor = pathVar;
    }
    return cached;
  });
}
