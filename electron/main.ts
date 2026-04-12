import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import * as fs from 'fs';
import { setupPtyService, destroyAllTerminals } from './services/pty';
import { setupClaudeService, destroyAllClaude } from './services/claude';

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 600,
    minHeight: 400,
    frame: false,
    transparent: false,
    backgroundColor: '#0a0a12',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.whenReady().then(() => {
  createWindow();
  setupPtyService(() => mainWindow);
  setupClaudeService(() => mainWindow);
});

app.on('window-all-closed', () => {
  destroyAllTerminals();
  destroyAllClaude();
  app.quit();
});

ipcMain.on('window:minimize', () => mainWindow?.minimize());
ipcMain.on('window:maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.on('window:close', () => mainWindow?.close());

const configPath = path.join(process.env.HOME || '/', '.config', 'tai', 'settings.json');

function readConfig(): Record<string, any> {
  try {
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(configPath)) return {};
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch { return {}; }
}

function writeConfig(config: Record<string, any>) {
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

ipcMain.handle('config:get', () => readConfig());
ipcMain.handle('config:set', (_event, key: string, value: any) => {
  const config = readConfig();
  config[key] = value;
  writeConfig(config);
  mainWindow?.webContents.send('config:changed', config);
  return config;
});
