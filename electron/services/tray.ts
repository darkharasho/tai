import { app, Menu, Tray, nativeImage, nativeTheme, type BrowserWindow } from 'electron';
import path from 'node:path';

// Each glyph ships at 16px with a 32px @2x sibling, which Electron resolves by
// filename convention.
export type TrayVariant = 'black' | 'white' | 'accent-on-dark' | 'accent-on-light';

const TRAY_FILES: Record<TrayVariant, string> = {
  black: 'tai-black',
  white: 'tai-white',
  'accent-on-dark': 'tai-tray-on-dark',
  'accent-on-light': 'tai-tray-on-light',
};

/**
 * Which glyph to show for a given theme.
 *
 * macOS is the odd one out: a template image is a black glyph with an alpha
 * channel that the OS recolours itself, so it stays correct through dark mode,
 * menubar tinting, and the inverted look while the menu is open. Picking a
 * white PNG by hand there would break the moment the menu is clicked.
 *
 * Everywhere else nothing recolours anything for us, so the glyph has to carry
 * its own contrast. `darkTheme` is only a hint — a panel's colour is set by the
 * panel's own theme, not the global colour-scheme preference, and the two
 * disagree on common setups (KDE's Breeze Twilight is a dark panel under a
 * light global theme). So the lead chevron follows the hint while the second
 * one keeps the spectrum gradient, which stays legible either way; guessing
 * wrong costs contrast on one stroke instead of hiding the whole icon.
 */
export function trayVariantFor(platform: NodeJS.Platform, darkTheme: boolean): TrayVariant {
  if (platform === 'darwin') return 'black';
  return darkTheme ? 'accent-on-dark' : 'accent-on-light';
}

/** Template images only apply on macOS; elsewhere the flag is meaningless. */
export function isTemplateImage(platform: NodeJS.Platform): boolean {
  return platform === 'darwin';
}

let tray: Tray | null = null;
let quitting = false;
let quitTracked = false;

/** True once a real quit is underway, so `close` handlers stop hiding the window. */
export function isQuitting(): boolean {
  return quitting;
}

/**
 * Flags a real quit without asking Electron to shut down yet.
 *
 * The updater needs the two halves separated. `autoUpdater.quitAndInstall()`
 * closes every window *before* it calls app.quit(), so `before-quit` has not
 * fired yet when the close handler runs: the handler sees what looks like a
 * plain close, hides to the tray, and the quit that was supposed to follow
 * never happens. The update then silently fails to install and the app is left
 * running with a hidden window. Marking the quit up front makes the close
 * handler let it through.
 */
export function markQuitting(): void {
  quitting = true;
}

/** Marks the app as quitting for real, then asks Electron to shut down. */
export function quitApp(): void {
  markQuitting();
  app.quit();
}

/**
 * Every quit route has to flip the quitting flag, not just our menu item: Cmd+Q,
 * the application menu, and a system logout all call app.quit() directly, and
 * without this the window's close handler would veto them — the app would
 * appear to ignore Cmd+Q entirely.
 *
 * Lives outside setupTray because it is needed whether or not a tray exists,
 * and because toggling the tray setting off and on would otherwise stack a new
 * listener per rebuild.
 */
export function registerQuitTracking(): void {
  if (quitTracked) return;
  quitTracked = true;
  app.on('before-quit', () => {
    quitting = true;
  });
}

export type CloseAction = 'allow' | 'hide' | 'quit';
/** What the user asked the close button to do. */
export type ClosePreference = 'quit' | 'tray';

/**
 * What a window `close` event should do.
 *
 * 'hide' is close-to-tray. The tray existing and the close button hiding to it
 * are separate choices — you can want an icon for quick access and still want
 * the X to quit — so the preference decides, with one hard constraint: with no
 * tray there is nothing to restore a hidden window from, and `window-all-closed`
 * is deliberately a no-op, so hiding would strand the app running with no
 * window and no icon. Without a tray, close always means quit.
 */
export function closeAction(s: {
  quitting: boolean;
  trayEnabled: boolean;
  closePreference?: ClosePreference;
}): CloseAction {
  if (s.quitting) return 'allow';
  if (!s.trayEnabled) return 'quit';
  return s.closePreference === 'quit' ? 'quit' : 'hide';
}

export type MinimizeAction = 'minimize' | 'hide';

/**
 * What the minimise button should do.
 *
 * 'hide' is minimise-to-tray: the window leaves the taskbar and only the tray
 * icon brings it back. Opt-in, since a minimise that vanishes from the taskbar
 * surprises anyone who did not ask for it — and like close-to-tray it needs a
 * tray to exist, or the hidden window would have no way back.
 */
export function minimizeAction(s: { trayEnabled: boolean; minimizeToTray?: boolean }): MinimizeAction {
  return s.trayEnabled && s.minimizeToTray === true ? 'hide' : 'minimize';
}

function iconPath(variant: TrayVariant): string {
  // Mirrors how main.ts resolves the window icon: public/ in dev, dist/ once
  // Vite has copied it for a packaged build.
  const base = process.env.VITE_DEV_SERVER_URL ? 'public' : 'dist';
  return path.join(__dirname, '..', base, 'img', `${TRAY_FILES[variant]}.png`);
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

/** Un-minimise, un-hide and focus the window — the close-to-tray inverse. */
export function revealWindow(win: BrowserWindow | null) {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

export function setupTray({ getWindow }: TrayDeps): Tray | null {
  if (tray) return tray;

  tray = new Tray(buildIcon());
  tray.setToolTip('TAI — Terminally AI');

  const menu = Menu.buildFromTemplate([
    { label: 'Show TAI', click: () => revealWindow(getWindow()) },
    { type: 'separator' },
    // Not role: 'quit' — that bypasses the quitting flag and the window would
    // hide instead of the app closing.
    { label: 'Quit TAI', click: quitApp },
  ]);
  tray.setContextMenu(menu);

  // On Windows and Linux a left click should restore the window. macOS opens
  // the context menu on either button, which is the platform convention.
  tray.on('click', () => revealWindow(getWindow()));

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
  quitTracked = false;
}
