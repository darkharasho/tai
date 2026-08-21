import { app, BrowserWindow, ipcMain, shell, dialog } from 'electron';
import path from 'path';
import * as fs from 'fs';
import { writeFile } from 'node:fs/promises';
import * as os from 'os';
import { spawn } from 'child_process';
import { setupPtyService, destroyAllTerminals } from './services/pty';
import { credentialVault } from './services/credentialVault';
import { setupClaudeService, destroyAllClaude } from './services/claude';
import { setupCodexService, destroyAllCodex } from './services/codex';
import { setupGitService } from './services/git';
import { setupGeminiService, destroyAllGemini } from './services/gemini';
import { initFocusTracking, setupNotifyService } from './services/notify';
import { registerUpdater } from './services/updater';
import { purgeStaleTempFiles } from './services/tempCleanup';
import { registerCommandIndexIpc } from './services/commandIndexStore';
import { registerWorkflowIpc } from './services/workflowStore';
import { registerRecordingSave } from './services/recordingSave';
import { setupTray, destroyTray, isQuitting, quitApp, revealWindow, registerQuitTracking, closeAction } from './services/tray';

// A dev run and the installed build share app.getPath('userData'), and the
// single-instance lock keys on that path. Once close-to-tray landed, the
// installed app stopped exiting when its window closed — so `npm run dev` lost
// the lock, quit itself, and its launch was handed to the AppImage sitting
// hidden in the tray, which dutifully revealed its window. It looked like dev
// was launching the installed app; it was.
//
// MUST run before requestSingleInstanceLock(): the lock key is derived from
// this path. Dev consequently gets its own settings.json and window state too,
// which is the point — a dev build should not mutate the real install's config.
if (process.env.VITE_DEV_SERVER_URL) {
  app.setPath('userData', `${app.getPath('userData')}-dev`);
}

// Closing the window only hides it, so a second launch would otherwise start a
// whole new app — its own PTYs, its own tray icon — while the first sat hidden.
// The icons stacked up one per launch. Hand the launch to the running instance
// instead.
const gotInstanceLock = app.requestSingleInstanceLock();
if (!gotInstanceLock) app.quit();

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

// On Linux, app.getPath('userData') resolves to ~/.config/tai (matching the
// previous hard-coded location), so existing settings/window-state are preserved.
// On Windows: %APPDATA%\tai\. On macOS: ~/Library/Application Support/tai/.
const windowStatePath = () => path.join(app.getPath('userData'), 'window-state.json');

function loadWindowState(): { x?: number; y?: number; width: number; height: number; maximized?: boolean } {
  try {
    if (fs.existsSync(windowStatePath())) {
      return JSON.parse(fs.readFileSync(windowStatePath(), 'utf8'));
    }
  } catch {}
  return { width: 1200, height: 800 };
}

function saveWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const maximized = mainWindow.isMaximized();
  const bounds = maximized ? mainWindow.getNormalBounds() : mainWindow.getBounds();
  const state = { ...bounds, maximized };
  try {
    const dir = path.dirname(windowStatePath());
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(windowStatePath(), JSON.stringify(state));
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
    ...(process.platform === 'darwin'
      ? { transparent: false, backgroundColor: '#0c0f11' }
      : { transparent: true, backgroundColor: '#00000000' }),
    icon: path.join(__dirname, '..', process.env.VITE_DEV_SERVER_URL ? 'public' : 'dist', 'img',
      process.platform === 'darwin' ? 'tai.icns' : 'tai.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  if (state.maximized) mainWindow.maximize();

  const devOrigin = process.env.VITE_DEV_SERVER_URL ? new URL(process.env.VITE_DEV_SERVER_URL).origin : null;
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (devOrigin && url.startsWith(devOrigin)) return;
    if (url.startsWith('file://')) return;
    event.preventDefault();
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('maximize', () => mainWindow?.webContents.send('window:maximized-change', true));
  mainWindow.on('unmaximize', () => mainWindow?.webContents.send('window:maximized-change', false));

  // Closing the window hides it to the tray and leaves the PTYs running; only
  // an explicit quit tears the app down. Window state is saved either way, so
  // the geometry survives both paths.
  mainWindow.on('close', (event) => {
    saveWindowState();
    // With the tray switched off there is no way back to a hidden window, so
    // close has to mean quit: `window-all-closed` is a deliberate no-op, and
    // simply letting the close through would strand the app running with no
    // window and no icon.
    switch (closeAction({ quitting: isQuitting(), trayEnabled: trayEnabled() })) {
      case 'allow': return;
      case 'quit': quitApp(); return;
      case 'hide':
        event.preventDefault();
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

app.on('second-instance', () => {
  revealWindow(mainWindow);
});

app.whenReady().then(() => {
  // A losing second instance still reaches whenReady before app.quit() lands;
  // building a window and a tray here is exactly what we are avoiding.
  if (!gotInstanceLock) return;

  purgeStaleTempFiles(os.tmpdir());
  registerCommandIndexIpc();
  registerWorkflowIpc();
  registerRecordingSave(ipcMain, {
    showSaveDialog: (opts) => dialog.showSaveDialog(opts),
    writeFile: (p, data) => writeFile(p, data, 'utf8'),
    defaultDir: () => app.getPath('documents'),
  });
  createWindow();
  if (mainWindow) initFocusTracking(mainWindow);
  registerUpdater(mainWindow!);
  setupPtyService(() => mainWindow);
  setupClaudeService(() => mainWindow);
  setupCodexService(() => mainWindow);
  setupGeminiService(() => mainWindow);
  setupNotifyService(() => mainWindow);
  setupGitService();
  // Registered whether or not a tray is built: every quit route (Cmd+Q, the
  // application menu, a system logout) has to flip the flag or the close
  // handler would veto it.
  registerQuitTracking();
  if (trayEnabled()) setupTray({ getWindow: () => mainWindow });
});

app.on('before-quit', () => {
  credentialVault.clear();
  destroyAllTerminals();
  destroyAllClaude();
  destroyAllCodex();
  destroyAllGemini();
  destroyTray();
});

// The window hides rather than closes, so this normally never fires. If the
// window is genuinely destroyed the tray is the only UI left, and quitting
// would strand the user with no way back — so hold the app open instead.
app.on('window-all-closed', () => {});

// macOS: clicking the dock icon after a close-to-tray reopens the window.
app.on('activate', () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  mainWindow.show();
  mainWindow.focus();
});

ipcMain.on('window:minimize', () => mainWindow?.minimize());
ipcMain.on('window:maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.on('window:close', () => mainWindow?.close());

const TRAY_SETTING = 'general.tray';

const configPath = () => path.join(app.getPath('userData'), 'settings.json');

function readConfig(): Record<string, any> {
  try {
    const file = configPath();
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(file)) return {};
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch { return {}; }
}

/** Default on: the setting only exists to turn the tray off. */
function trayEnabled(): boolean {
  return readConfig()[TRAY_SETTING] !== false;
}

function writeConfig(config: Record<string, any>) {
  const file = configPath();
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(config, null, 2));
}

ipcMain.handle('system:hostname', () => process.env.HOSTNAME || os.hostname());

ipcMain.handle('shell:openExternal', async (_event, url: string) => {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return false;
  await shell.openExternal(url);
  return true;
});

ipcMain.handle('config:get', () => readConfig());
ipcMain.handle('config:set', (_event, key: string, value: any) => {
  const config = readConfig();
  config[key] = value;
  writeConfig(config);
  // Applied live rather than on next launch — a setting whose effect you cannot
  // see until you restart reads as broken.
  if (key === TRAY_SETTING) {
    if (value === false) destroyTray(); else setupTray({ getWindow: () => mainWindow });
  }
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('config:changed', config);
  return config;
});

// Daemon install helpers
ipcMain.handle('tai:daemon:check', async (_event, target: string) => {
  // Returns { installed: boolean, version?: string }
  return new Promise<{ installed: boolean; version?: string }>((resolve) => {
    const proc = spawn('ssh', [target, '~/.tai/tai-daemon', '--version'], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    let output = '';
    proc.stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); });
    proc.on('exit', (code) => {
      if (code === 0) {
        resolve({ installed: true, version: output.trim() });
      } else {
        resolve({ installed: false });
      }
    });
    // Timeout after 10s
    setTimeout(() => { proc.kill(); resolve({ installed: false }); }, 10000);
  });
});

ipcMain.handle('tai:daemon:install', async (_event, target: string) => {
  // Detect arch, scp correct binary, chmod +x
  // Returns { success: boolean, error?: string }
  const arch = await new Promise<{ os: string; arch: string } | null>((resolve) => {
    const proc = spawn('ssh', [target, 'uname -s && uname -m'], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    let output = '';
    proc.stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); });
    proc.on('exit', (code) => {
      if (code !== 0) { resolve(null); return; }
      const lines = output.trim().split('\n');
      resolve({ os: lines[0]?.trim() || '', arch: lines[1]?.trim() || '' });
    });
    setTimeout(() => { proc.kill(); resolve(null); }, 10000);
  });

  if (!arch) return { success: false, error: 'Failed to detect remote architecture' };

  // Map uname output to binary name
  const osName = arch.os.toLowerCase();
  const archName = arch.arch.toLowerCase();
  let binaryName: string;
  if (osName === 'linux' && archName === 'x86_64') binaryName = 'tai-daemon-linux-amd64';
  else if (osName === 'linux' && archName === 'aarch64') binaryName = 'tai-daemon-linux-arm64';
  else if (osName === 'darwin' && archName === 'x86_64') binaryName = 'tai-daemon-darwin-amd64';
  else if (osName === 'darwin' && (archName === 'arm64' || archName === 'aarch64')) binaryName = 'tai-daemon-darwin-arm64';
  else return { success: false, error: `Unsupported platform: ${arch.os} ${arch.arch}` };

  // Find bundled binary
  const daemonDir = app.isPackaged
    ? path.join(process.resourcesPath, 'daemon', 'dist')
    : path.join(__dirname, '..', 'daemon', 'dist');
  const binaryPath = path.join(daemonDir, binaryName);

  if (!fs.existsSync(binaryPath)) {
    return { success: false, error: `Bundled binary not found: ${binaryName}` };
  }

  // SCP to remote
  const installResult = await new Promise<{ success: boolean; error?: string }>((resolve) => {
    // First ensure ~/.tai exists, then scp
    const mkdirProc = spawn('ssh', [target, 'mkdir -p ~/.tai'], {
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    mkdirProc.on('exit', (code) => {
      if (code !== 0) { resolve({ success: false, error: 'Failed to create ~/.tai directory' }); return; }

      const scpProc = spawn('scp', [binaryPath, `${target}:~/.tai/tai-daemon`], {
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      let errOutput = '';
      scpProc.stderr?.on('data', (chunk: Buffer) => { errOutput += chunk.toString(); });
      scpProc.on('exit', (scpCode) => {
        if (scpCode !== 0) { resolve({ success: false, error: errOutput.trim() || 'scp failed' }); return; }

        // chmod +x
        const chmodProc = spawn('ssh', [target, 'chmod +x ~/.tai/tai-daemon'], {
          stdio: ['ignore', 'ignore', 'ignore'],
        });
        chmodProc.on('exit', (chmodCode) => {
          if (chmodCode !== 0) { resolve({ success: false, error: 'chmod +x failed' }); return; }
          resolve({ success: true });
        });
        setTimeout(() => { chmodProc.kill(); resolve({ success: false, error: 'chmod timed out' }); }, 10000);
      });
      setTimeout(() => { scpProc.kill(); resolve({ success: false, error: 'scp timed out' }); }, 60000);
    });
    setTimeout(() => { mkdirProc.kill(); resolve({ success: false, error: 'mkdir timed out' }); }, 10000);
  });

  return installResult;
});
