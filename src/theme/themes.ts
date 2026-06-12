import type { ITheme } from '@xterm/xterm';

/**
 * Theme registry. The DOM is themed entirely through CSS custom properties
 * (see src/styles/globals.css — `:root` is the default theme, each
 * `[data-theme="<id>"]` block overrides it). xterm.js cannot read CSS
 * variables, so each theme mirrors its ANSI palette here as a literal
 * ITheme. Keep the two in sync: --ansi-30…37 / --ansi-90…97 in globals.css
 * must match black…white / brightBlack…brightWhite below.
 */

export type ThemeId = 'default' | 'graphite' | 'ash' | 'fjord' | 'ember' | 'cosmos' | 'abyss' | 'magma';

export interface ThemeDef {
  id: ThemeId;
  label: string;
  xterm: ITheme;
}

export const THEMES: ThemeDef[] = [
  {
    id: 'default',
    label: 'Tai Dark',
    xterm: {
      background: '#141719',
      foreground: '#bec6d0',
      cursor: '#bec6d0',
      cursorAccent: '#141719',
      selectionBackground: 'rgba(168, 95, 241, 0.3)',
      black: '#0c0f11', red: '#E35535', green: '#00a884', yellow: '#c7910c',
      blue: '#11B7D4', magenta: '#d46ec0', cyan: '#38c7bd', white: '#bec6d0',
      brightBlack: '#5a6a7a', brightRed: '#E35535', brightGreen: '#00a884', brightYellow: '#f5b832',
      brightBlue: '#11B7D4', brightMagenta: '#a85ff1', brightCyan: '#38c7bd', brightWhite: '#ffffff',
    },
  },
  {
    id: 'graphite',
    label: 'Graphite',
    xterm: {
      background: '#121215',
      foreground: '#c9cdd4',
      cursor: '#c9cdd4',
      cursorAccent: '#121215',
      selectionBackground: 'rgba(157, 140, 255, 0.28)',
      black: '#0a0a0c', red: '#e06054', green: '#2ec98e', yellow: '#d4a432',
      blue: '#6ca4e0', magenta: '#c47fd6', cyan: '#46c2b8', white: '#c9cdd4',
      brightBlack: '#62676f', brightRed: '#ea7565', brightGreen: '#3ddc9c', brightYellow: '#e8bc4a',
      brightBlue: '#82b5ec', brightMagenta: '#d494e6', brightCyan: '#5cd6cc', brightWhite: '#f2f3f5',
    },
  },
  {
    id: 'ash',
    label: 'Ash',
    xterm: {
      background: '#24272c',
      foreground: '#e2e5ea',
      cursor: '#e2e5ea',
      cursorAccent: '#24272c',
      selectionBackground: 'rgba(143, 127, 242, 0.3)',
      black: '#1b1d20', red: '#e25b48', green: '#29b88a', yellow: '#c79a2d',
      blue: '#58a8d6', magenta: '#c272d4', cyan: '#3fbcb2', white: '#e2e5ea',
      brightBlack: '#7d848f', brightRed: '#ef7361', brightGreen: '#36d4a2', brightYellow: '#e0b13e',
      brightBlue: '#74bce4', brightMagenta: '#d58ce4', brightCyan: '#54d2c8', brightWhite: '#ffffff',
    },
  },
  {
    id: 'fjord',
    label: 'Fjord',
    xterm: {
      background: '#1c222e',
      foreground: '#d8dee9',
      cursor: '#d8dee9',
      cursorAccent: '#1c222e',
      selectionBackground: 'rgba(180, 142, 173, 0.3)',
      black: '#151922', red: '#bf616a', green: '#a3be8c', yellow: '#ebcb8b',
      blue: '#81a1c1', magenta: '#b48ead', cyan: '#88c0d0', white: '#d8dee9',
      brightBlack: '#697489', brightRed: '#d0707a', brightGreen: '#b4cf9d', brightYellow: '#f0d8a0',
      brightBlue: '#93b1d4', brightMagenta: '#c49ec4', brightCyan: '#9cd2e0', brightWhite: '#eceff4',
    },
  },
  {
    id: 'ember',
    label: 'Ember',
    xterm: {
      background: '#211a16',
      foreground: '#d8cfc4',
      cursor: '#d8cfc4',
      cursorAccent: '#211a16',
      selectionBackground: 'rgba(224, 120, 64, 0.25)',
      black: '#171210', red: '#e25d45', green: '#9fb554', yellow: '#ddae4a',
      blue: '#7d9dc4', magenta: '#c490e4', cyan: '#58b5c4', white: '#d8cfc4',
      brightBlack: '#7a6f63', brightRed: '#ef7259', brightGreen: '#b2c968', brightYellow: '#efc25e',
      brightBlue: '#93b2d8', brightMagenta: '#d4a8f0', brightCyan: '#6fc9d8', brightWhite: '#f5efe6',
    },
  },
  {
    id: 'cosmos',
    label: 'Cosmos',
    xterm: {
      background: '#121226',
      foreground: '#d2d5f0',
      cursor: '#5eead4',
      cursorAccent: '#121226',
      selectionBackground: 'rgba(167, 139, 250, 0.32)',
      black: '#0a0a16', red: '#f87171', green: '#34d399', yellow: '#fbbf24',
      blue: '#818cf8', magenta: '#e879f9', cyan: '#67e8f9', white: '#d2d5f0',
      brightBlack: '#5f6294', brightRed: '#fca5a5', brightGreen: '#6ee7b7', brightYellow: '#fcd34d',
      brightBlue: '#a5b4fc', brightMagenta: '#f0abfc', brightCyan: '#a5f3fc', brightWhite: '#ffffff',
    },
  },
  {
    id: 'abyss',
    label: 'Abyss',
    xterm: {
      background: '#0d1d29',
      foreground: '#c6dbe5',
      cursor: '#c6dbe5',
      cursorAccent: '#0d1d29',
      selectionBackground: 'rgba(84, 200, 232, 0.28)',
      black: '#06121a', red: '#ef6e64', green: '#35d0a0', yellow: '#e8c252',
      blue: '#6ea3ee', magenta: '#c585e0', cyan: '#54c8e8', white: '#c6dbe5',
      brightBlack: '#54748a', brightRed: '#f58a80', brightGreen: '#5fe0b8', brightYellow: '#f2d478',
      brightBlue: '#8ab8f2', brightMagenta: '#d6a2ec', brightCyan: '#7cd8f0', brightWhite: '#f0f8fc',
    },
  },
  {
    id: 'magma',
    label: 'Magma',
    xterm: {
      background: '#1f140d',
      foreground: '#e0d2c8',
      cursor: '#f5a83c',
      cursorAccent: '#1f140d',
      selectionBackground: 'rgba(255, 90, 42, 0.28)',
      black: '#150d09', red: '#ff4d4d', green: '#a8b860', yellow: '#ffd23f',
      blue: '#6f9ed8', magenta: '#c06ee8', cyan: '#56b8d8', white: '#e0d2c8',
      brightBlack: '#826f62', brightRed: '#ff6d6d', brightGreen: '#bcd072', brightYellow: '#ffe06a',
      brightBlue: '#8ab4e8', brightMagenta: '#d490f5', brightCyan: '#74ccea', brightWhite: '#fdf3ea',
    },
  },
];

export const THEME_OPTIONS = THEMES.map(t => ({ value: t.id, label: t.label }));

const DEFAULT_THEME = THEMES[0];

export function getTheme(id: string | undefined): ThemeDef {
  return THEMES.find(t => t.id === id) ?? DEFAULT_THEME;
}

/* Active-theme store. App.tsx pushes the persisted setting in here; xterm
   instances (which can't react to CSS variables) subscribe for live
   palette swaps without a dispose/recreate. */

let active: ThemeDef = DEFAULT_THEME;
const listeners = new Set<(theme: ThemeDef) => void>();

export function setActiveTheme(id: string | undefined): void {
  const next = getTheme(id);
  if (next === active) return;
  active = next;
  listeners.forEach(fn => fn(next));
}

export function getActiveTheme(): ThemeDef {
  return active;
}

export function subscribeTheme(fn: (theme: ThemeDef) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
