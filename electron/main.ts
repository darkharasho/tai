import { app, BrowserWindow, ipcMain, Tray, Menu, nativeTheme, nativeImage } from 'electron';
import path from 'path';
import * as fs from 'fs';
import { setupPtyService, destroyAllTerminals } from './services/pty';
import { setupClaudeService, destroyAllClaude } from './services/claude';
import { registerUpdater } from './services/updater';

app.disableHardwareAcceleration();
if (process.platform === 'win32') app.setAppUserModelId('com.tai.app');
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('class', 'tai');
  app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
  app.setDesktopName('tai.desktop');
}
app.name = 'tai';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

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
    frame: false,
    transparent: false,
    backgroundColor: '#0c0f11',
    icon: path.join(__dirname, '..', process.env.VITE_DEV_SERVER_URL ? 'public' : 'dist', 'img', 'tai.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  if (state.maximized) mainWindow.maximize();

  mainWindow.on('close', (e) => {
    saveWindowState();
    if (!isQuitting) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });
  mainWindow.on('resize', saveWindowState);
  mainWindow.on('move', saveWindowState);

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

function getTrayIconPath(): string {
  const isDark = process.platform === 'linux' || nativeTheme.shouldUseDarkColors;
  const file = isDark ? 'tai-white.png' : 'tai-black.png';
  if (process.env.VITE_DEV_SERVER_URL) {
    return path.join(__dirname, '..', 'public', 'img', file);
  }
  return path.join(__dirname, '..', 'dist', 'img', file);
}

function createTray() {
  const icon = nativeImage.createFromPath(getTrayIconPath()).resize({ width: 22, height: 22 });
  tray = new Tray(icon);
  tray.setToolTip('tai');

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show', click: () => { mainWindow?.show(); mainWindow?.focus(); } },
    { type: 'separator' },
    { label: 'Quit', click: () => { isQuitting = true; destroyAllTerminals(); destroyAllClaude(); app.quit(); } },
  ]);
  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) { mainWindow.focus(); }
      else { mainWindow.show(); mainWindow.focus(); }
    } else {
      createWindow();
    }
  });

  if (process.platform !== 'linux') {
    nativeTheme.on('updated', () => {
      const newIcon = nativeImage.createFromPath(getTrayIconPath()).resize({ width: 22, height: 22 });
      tray?.setImage(newIcon);
    });
  }
}

app.whenReady().then(() => {
  createWindow();
  createTray();
  registerUpdater(mainWindow!);
  setupPtyService(() => mainWindow);
  setupClaudeService(() => mainWindow);
});

app.on('before-quit', () => {
  isQuitting = true;
  destroyAllTerminals();
  destroyAllClaude();
});

app.on('window-all-closed', () => {
  // Keep running in tray
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
