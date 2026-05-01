import { Notification, BrowserWindow, ipcMain, app } from 'electron';
import * as path from 'node:path';
import * as fs from 'node:fs';

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

function isEnabled(): boolean {
  try {
    const settings = JSON.parse(fs.readFileSync(settingsFile(), 'utf-8'));
    return settings.systemNotifications === true;
  } catch {
    return false;
  }
}

let windowFocused = true;
let activeTabId = '';

export function initFocusTracking(win: BrowserWindow) {
  win.on('focus', () => { windowFocused = true; });
  win.on('blur', () => { windowFocused = false; });
  windowFocused = win.isFocused();
}

export interface CompletionInfo {
  kind: 'command' | 'ai';
  tabId: string;
  tabLabel?: string;
  provider?: string;
  command?: string;
  duration?: number;
  summary?: string;
}

function formatDuration(ms: number): string {
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return rem > 0 ? `${mins}m ${rem}s` : `${mins}m`;
}

function notifyCompletion(win: BrowserWindow, info: CompletionInfo) {
  if (win.isDestroyed()) return;
  if (windowFocused && info.tabId === activeTabId) return;
  if (!isEnabled()) return;

  win.flashFrame(true);

  if (!Notification.isSupported()) return;

  const tabName = info.tabLabel || info.tabId;
  const parts: string[] = [];
  if (info.provider) parts.push(info.provider);
  if (info.duration) parts.push(formatDuration(info.duration));
  const meta = parts.length > 0 ? ` (${parts.join(' · ')})` : '';

  const title = info.kind === 'ai'
    ? `AI response complete — ${tabName}`
    : `Command finished — ${tabName}`;

  let body = info.kind === 'ai'
    ? `${tabName} finished responding${meta}`
    : info.command
      ? `${truncate(info.command, 100)}${meta}`
      : `Command finished${meta}`;

  if (info.summary) body += `\n${truncate(info.summary, 100)}`;

  new Notification({ title, body }).show();
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

export function setupNotifyService(getWindow: () => BrowserWindow | null) {
  ipcMain.on('notify:setActiveTab', (_event, tabId: string) => {
    activeTabId = tabId || '';
  });

  ipcMain.on('notify:completion', (_event, info: CompletionInfo) => {
    const win = getWindow();
    if (!win) return;
    notifyCompletion(win, info);
  });
}
