import { app, ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import {
  CommandIndex, IngestEntry, createIndex, ingestBlock, capIndex, MAX_INDEX_COMMANDS,
} from '../../src/utils/commandIndex';

const SAVE_DEBOUNCE_MS = 5000;
const indexFile = () => path.join(app.getPath('userData'), 'command-index.json');

export function serializeIndex(index: CommandIndex): string {
  return JSON.stringify(index);
}

export function deserializeIndex(raw: string | null, now: number): CommandIndex {
  if (!raw) return createIndex();
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.stats !== 'object' || Array.isArray(parsed.stats) ||
        typeof parsed.next !== 'object') {
      return createIndex();
    }
    const idx: CommandIndex = { stats: parsed.stats, next: parsed.next ?? {} };
    if (Object.keys(idx.stats).length > MAX_INDEX_COMMANDS) capIndex(idx, now);
    return idx;
  } catch {
    return createIndex();
  }
}

let memo: CommandIndex | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

export function loadIndex(): CommandIndex {
  if (memo) return memo;
  let raw: string | null = null;
  try { raw = fs.readFileSync(indexFile(), 'utf-8'); } catch { raw = null; }
  memo = deserializeIndex(raw, Date.now());
  return memo;
}

function flushNow(): void {
  if (!memo) return;
  try { fs.writeFileSync(indexFile(), serializeIndex(memo), { mode: 0o600 }); } catch { /* best effort */ }
}

export function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveTimer = null; flushNow(); }, SAVE_DEBOUNCE_MS);
}

export function registerCommandIndexIpc(): void {
  ipcMain.handle('commandIndex:get', () => loadIndex());
  ipcMain.on('commandIndex:ingest', (_e, entries: IngestEntry[]) => {
    const idx = loadIndex();
    for (const entry of entries) ingestBlock(idx, entry);
    capIndex(idx, Date.now());
    scheduleSave();
  });
  ipcMain.on('commandIndex:flush', () => { if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; } flushNow(); });
}
