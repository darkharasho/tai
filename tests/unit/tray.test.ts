import { describe, it, expect, vi, beforeEach } from 'vitest';

const listeners: Record<string, Array<() => void>> = {};
const trayInstance = {
  setToolTip: vi.fn(),
  setContextMenu: vi.fn(),
  setImage: vi.fn(),
  isDestroyed: vi.fn(() => false),
  destroy: vi.fn(),
  on: vi.fn((event: string, fn: () => void) => {
    (listeners[`tray:${event}`] ||= []).push(fn);
  }),
};

const image = { setTemplateImage: vi.fn() };

vi.mock('electron', () => ({
  app: {
    quit: vi.fn(),
    on: vi.fn((event: string, fn: () => void) => {
      (listeners[`app:${event}`] ||= []).push(fn);
    }),
  },
  Menu: { buildFromTemplate: vi.fn((template) => template) },
  // Must be a function expression, not an arrow — it is invoked with `new`.
  Tray: vi.fn(function () {
    return trayInstance;
  }),
  nativeImage: { createFromPath: vi.fn(() => image) },
  nativeTheme: {
    shouldUseDarkColors: false,
    on: vi.fn((event: string, fn: () => void) => {
      (listeners[`theme:${event}`] ||= []).push(fn);
    }),
  },
}));

import { app, Tray, nativeImage } from 'electron';
import {
  trayVariantFor,
  isTemplateImage,
  setupTray,
  quitApp,
  markQuitting,
  isQuitting,
  destroyTray,
  resetTrayState,
  registerQuitTracking,
  closeAction,
} from '../../electron/services/tray';

const fire = (key: string) => (listeners[key] || []).forEach((fn) => fn());

describe('trayVariantFor', () => {
  it('always uses the black glyph on macOS so it can be a template image', () => {
    expect(trayVariantFor('darwin', false)).toBe('black');
    expect(trayVariantFor('darwin', true)).toBe('black');
  });

  it('uses the light-panel accent glyph on a dark theme elsewhere', () => {
    expect(trayVariantFor('win32', true)).toBe('accent-on-dark');
    expect(trayVariantFor('linux', true)).toBe('accent-on-dark');
  });

  it('uses the dark-panel accent glyph on a light theme elsewhere', () => {
    expect(trayVariantFor('win32', false)).toBe('accent-on-light');
    expect(trayVariantFor('linux', false)).toBe('accent-on-light');
  });

  // Off macOS nothing recolours the glyph for us, so a flat mono variant would
  // vanish whenever the panel disagrees with the colour-scheme hint.
  it('never picks a flat mono glyph off macOS', () => {
    for (const platform of ['win32', 'linux'] as const) {
      for (const dark of [true, false]) {
        expect(['black', 'white']).not.toContain(trayVariantFor(platform, dark));
      }
    }
  });
});

describe('isTemplateImage', () => {
  it('is macOS-only', () => {
    expect(isTemplateImage('darwin')).toBe(true);
    expect(isTemplateImage('win32')).toBe(false);
    expect(isTemplateImage('linux')).toBe(false);
  });
});

describe('setupTray', () => {
  beforeEach(() => {
    for (const key of Object.keys(listeners)) delete listeners[key];
    vi.clearAllMocks();
    resetTrayState();
  });

  it('creates exactly one tray even if called twice', () => {
    const deps = { getWindow: () => null };
    setupTray(deps);
    setupTray(deps);
    expect(Tray).toHaveBeenCalledTimes(1);
  });

  it('restores a hidden window when the tray is clicked', () => {
    const win = {
      isDestroyed: () => false,
      isMinimized: () => true,
      restore: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
    };
    setupTray({ getWindow: () => win as never });
    fire('tray:click');
    expect(win.restore).toHaveBeenCalled();
    expect(win.show).toHaveBeenCalled();
    expect(win.focus).toHaveBeenCalled();
  });

  it('does not throw when clicked with no window', () => {
    setupTray({ getWindow: () => null });
    expect(() => fire('tray:click')).not.toThrow();
  });

  it('repaints the icon when the system theme changes', () => {
    setupTray({ getWindow: () => null });
    vi.mocked(nativeImage.createFromPath).mockClear();
    fire('theme:updated');
    expect(nativeImage.createFromPath).toHaveBeenCalled();
    expect(trayInstance.setImage).toHaveBeenCalled();
  });
});

describe('quit handling', () => {
  beforeEach(() => {
    for (const key of Object.keys(listeners)) delete listeners[key];
    vi.clearAllMocks();
    resetTrayState();
  });

  it('starts out not quitting, so a close hides instead', () => {
    setupTray({ getWindow: () => null });
    expect(isQuitting()).toBe(false);
  });

  it('flags quitting via the tray menu item', () => {
    setupTray({ getWindow: () => null });
    quitApp();
    expect(isQuitting()).toBe(true);
    expect(app.quit).toHaveBeenCalled();
  });

  // The regression that makes Cmd+Q silently stop working: app.quit() bypasses
  // quitApp(), so without a before-quit hook the window vetoes its own close.
  it('flags quitting when something else calls app.quit (Cmd+Q, logout)', () => {
    // registerQuitTracking, not setupTray: the hook has to exist even with the
    // tray setting off, or Cmd+Q would be vetoed by the window's close handler.
    registerQuitTracking();
    expect(isQuitting()).toBe(false);
    fire('app:before-quit');
    expect(isQuitting()).toBe(true);
  });

  // An update installs by closing the windows and only then quitting, so the
  // flag has to be settable without app.quit() — otherwise the close handler
  // hides to the tray, the quit never lands, and the update silently fails
  // while the app keeps running with no window.
  it('can flag a quit without shutting down yet, for the updater', () => {
    setupTray({ getWindow: () => null });
    markQuitting();
    expect(isQuitting()).toBe(true);
    expect(app.quit).not.toHaveBeenCalled();
    expect(closeAction({ quitting: isQuitting(), trayEnabled: true })).toBe('allow');
  });

  // Toggling the tray setting off and on rebuilds the tray; the quit hook must
  // not stack up one listener per rebuild.
  it('registers the before-quit hook exactly once', () => {
    registerQuitTracking();
    registerQuitTracking();
    registerQuitTracking();
    expect((listeners['app:before-quit'] || []).length).toBe(1);
  });

  it('no longer ties the quit hook to the tray existing', () => {
    setupTray({ getWindow: () => null });
    expect(listeners['app:before-quit']).toBeUndefined();
  });

  it('destroys the tray only when it is still alive', () => {
    setupTray({ getWindow: () => null });
    destroyTray();
    expect(trayInstance.destroy).toHaveBeenCalledTimes(1);
    destroyTray();
    expect(trayInstance.destroy).toHaveBeenCalledTimes(1);
  });
});

describe('closeAction', () => {
  it('hides to the tray on a plain close', () => {
    expect(closeAction({ quitting: false, trayEnabled: true })).toBe('hide');
  });

  // Without a tray there is no way back to a hidden window, and
  // window-all-closed is a deliberate no-op — allowing the close would leave
  // the app running with no window and no icon.
  it('quits on close when the tray is switched off', () => {
    expect(closeAction({ quitting: false, trayEnabled: false })).toBe('quit');
  });

  it('lets a real quit through either way', () => {
    expect(closeAction({ quitting: true, trayEnabled: true })).toBe('allow');
    expect(closeAction({ quitting: true, trayEnabled: false })).toBe('allow');
  });
});
