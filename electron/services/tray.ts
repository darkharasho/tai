import { app, Menu, Tray, nativeImage, nativeTheme, type BrowserWindow } from 'electron';
import path from 'node:path';

// The tray glyph ships as two flat-colour PNGs (plus @2x siblings, which
// Electron resolves by filename convention).
export type TrayVariant = 'black' | 'white';

/**
 * Which glyph to show for a given theme.
 *
 * macOS is the odd one out: a template image is a black glyph with an alpha
 * channel that the OS recolours itself, so it stays correct through dark mode,
 * menubar tinting, and the inverted look while the menu is open. Picking a
 * white PNG by hand there would break the moment the menu is clicked.
 *
 * Everywhere else nothing recolours anything for us, so the icon has to
 * contrast against the taskbar: white glyph on a dark theme, black on light.
 */
export function trayVariantFor(platform: NodeJS.Platform, darkTheme: boolean): TrayVariant {
  if (platform === 'darwin') return 'black';
  return darkTheme ? 'white' : 'black';
}

/** Template images only apply on macOS; elsewhere the flag is meaningless. */
export function isTemplateImage(platform: NodeJS.Platform): boolean {
  return platform === 'darwin';
}

let tray: Tray | null = null;
let quitting = false;

/** True once a real quit is underway, so `close` handlers stop hiding the window. */
export function isQuitting(): boolean {
  return quitting;
}

/** Marks the app as quitting for real, then asks Electron to shut down. */
export function quitApp(): void {
  quitting = true;
  app.quit();
}

function iconPath(variant: TrayVariant): string {
  // Mirrors how main.ts resolves the window icon: public/ in dev, dist/ once
  // Vite has copied it for a packaged build.
  const base = process.env.VITE_DEV_SERVER_URL ? 'public' : 'dist';
  return path.join(__dirname, '..', base, 'img', `tai-${variant}.png`);
}

function buildIcon() {
  const variant = trayVariantFor(process.platform, nativeTheme.shouldUseDarkColors);
  const image = nativeImage.createFromPath(iconPath(variant));
  if (isTemplateImage(process.platform)) image.setTemplateImage(true);
  return image;
}

export interface TrayDeps {
  getWindow: () => BrowserWindow | null;
}

function showWindow(win: BrowserWindow | null) {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

export function setupTray({ getWindow }: TrayDeps): Tray | null {
  if (tray) return tray;

  // Every quit route has to flip this, not just our menu item: Cmd+Q, the
  // application menu, and a system logout all call app.quit() directly. Without
  // this the window's close handler would veto them and the app would appear
  // to ignore Cmd+Q entirely.
  app.on('before-quit', () => {
    quitting = true;
  });

  tray = new Tray(buildIcon());
  tray.setToolTip('TAI — Terminally AI');

  const menu = Menu.buildFromTemplate([
    { label: 'Show TAI', click: () => showWindow(getWindow()) },
    { type: 'separator' },
    // Not role: 'quit' — that bypasses the quitting flag and the window would
    // hide instead of the app closing.
    { label: 'Quit TAI', click: quitApp },
  ]);
  tray.setContextMenu(menu);

  // On Windows and Linux a left click should restore the window. macOS opens
  // the context menu on either button, which is the platform convention.
  tray.on('click', () => showWindow(getWindow()));

  // Only matters off macOS, where template images already track the theme.
  nativeTheme.on('updated', () => {
    if (tray && !tray.isDestroyed()) tray.setImage(buildIcon());
  });

  return tray;
}

export function destroyTray(): void {
  if (tray && !tray.isDestroyed()) tray.destroy();
  tray = null;
}

/** Test seam — resets module state between cases. */
export function resetTrayState(): void {
  tray = null;
  quitting = false;
}
