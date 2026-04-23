import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

export const isWindows = process.platform === 'win32';

function collectNvmBins(home: string): string[] {
  const bins: string[] = [];
  const nvmDir = path.join(home, '.nvm', 'versions', 'node');
  if (!fs.existsSync(nvmDir)) return bins;
  try {
    for (const v of fs.readdirSync(nvmDir)) {
      bins.push(path.join(nvmDir, v, isWindows ? '' : 'bin'));
    }
  } catch { /* ignore */ }
  return bins;
}

export function platformExtraPaths(): string[] {
  const home = os.homedir();
  const extras: string[] = [];

  if (isWindows) {
    const appData = process.env.APPDATA;
    if (appData) extras.push(path.join(appData, 'npm'));
    const localAppData = process.env.LOCALAPPDATA;
    if (localAppData) {
      extras.push(path.join(localAppData, 'Programs', 'Python', 'Scripts'));
      extras.push(path.join(localAppData, 'Microsoft', 'WindowsApps'));
    }
    const scoopShims = path.join(home, 'scoop', 'shims');
    if (fs.existsSync(scoopShims)) extras.push(scoopShims);
  } else {
    extras.push(
      path.join(home, '.local', 'bin'),
      path.join(home, '.volta', 'bin'),
      '/usr/local/bin',
      '/opt/homebrew/bin',
    );
  }

  extras.push(...collectNvmBins(home));
  return extras;
}

export function enrichEnv(): Record<string, string> {
  const env = { ...process.env } as Record<string, string>;
  const extras = platformExtraPaths();
  const delim = path.delimiter;
  const currentPath = env.PATH || env.Path || '';
  const existing = new Set(currentPath.split(delim).filter(Boolean));
  const additions = extras.filter(p => p && !existing.has(p));
  if (additions.length > 0) {
    env.PATH = additions.join(delim) + (currentPath ? delim + currentPath : '');
  }
  return env;
}

export function resolveBinary(name: string, env: Record<string, string>): string {
  if (!isWindows) return name;
  const exts = ['.cmd', '.exe', '.bat', '.ps1', ''];
  const dirs = (env.PATH || env.Path || '').split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext);
      try {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          return candidate;
        }
      } catch { /* ignore */ }
    }
  }
  return name;
}
