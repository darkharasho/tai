import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { setupPtyService, destroyAllTerminals } from './services/pty';
import { setupClaudeService, destroyAllClaude } from './services/claude';
import { registerUpdater } from './services/updater';

app.disableHardwareAcceleration();
if (process.env.VITE_DEV_SERVER_URL) {
  app.commandLine.appendSwitch('remote-debugging-port', '9222');
}
if (process.platform === 'win32') app.setAppUserModelId('com.tai.app');
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('class', 'tai');
  app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
  app.setDesktopName('tai.desktop');
}
app.name = 'tai';

let mainWindow: BrowserWindow | null = null;

const windowStatePath = path.join(process.env.HOME || '/', '.config', 'tai', 'window-state.json');

function loadWindowState(): { x?: number; y?: number; width: number; height: number; maximized?: boolean } {
  try {
    if (fs.existsSync(windowStatePath)) {
      return JSON.parse(fs.readFileSync(windowStatePath, 'utf8'));
    }
  } catch {}
  return { width: 1200, height: 800 };
}

function saveWindowState() {
  if (!mainWindow) return;
  const maximized = mainWindow.isMaximized();
  const bounds = maximized ? mainWindow.getNormalBounds() : mainWindow.getBounds();
  const state = { ...bounds, maximized };
  try {
    const dir = path.dirname(windowStatePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(windowStatePath, JSON.stringify(state));
  } catch {}
}

function createWindow() {
  const state = loadWindowState();
  mainWindow = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 600,
    minHeight: 400,
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 12, y: 14 } }
      : { frame: false }),
    transparent: false,
    backgroundColor: '#0c0f11',
    icon: path.join(__dirname, '..', process.env.VITE_DEV_SERVER_URL ? 'public' : 'dist', 'img',
      process.platform === 'darwin' ? 'tai.icns' : 'tai.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  if (state.maximized) mainWindow.maximize();

  mainWindow.on('close', () => {
    saveWindowState();
  });
  mainWindow.on('resize', saveWindowState);
  mainWindow.on('move', saveWindowState);

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.whenReady().then(() => {
  createWindow();
  registerUpdater(mainWindow!);
  setupPtyService(() => mainWindow);
  setupClaudeService(() => mainWindow);
});

app.on('before-quit', () => {
  destroyAllTerminals();
  destroyAllClaude();
});

app.on('window-all-closed', () => {
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

ipcMain.handle('system:hostname', () => os.hostname());

ipcMain.handle('config:get', () => readConfig());
ipcMain.handle('config:set', (_event, key: string, value: any) => {
  const config = readConfig();
  config[key] = value;
  writeConfig(config);
  mainWindow?.webContents.send('config:changed', config);
  return config;
});
