import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { THEMES, getTheme, setActiveTheme, getActiveTheme, subscribeTheme } from '@/theme/themes';
import { ansiToHtml } from '@/utils/ansiToHtml';

const ANSI_KEYS: [number, string][] = [
  [30, 'black'], [31, 'red'], [32, 'green'], [33, 'yellow'],
  [34, 'blue'], [35, 'magenta'], [36, 'cyan'], [37, 'white'],
  [90, 'brightBlack'], [91, 'brightRed'], [92, 'brightGreen'], [93, 'brightYellow'],
  [94, 'brightBlue'], [95, 'brightMagenta'], [96, 'brightCyan'], [97, 'brightWhite'],
];

const css = readFileSync(join(__dirname, '../../src/styles/globals.css'), 'utf8');

/** Extract the rule body for a theme: `:root` for default, `[data-theme=id]` otherwise. */
function themeBlock(id: string): string {
  const selector = id === 'default' ? ':root' : `[data-theme="${id}"]`;
  const start = css.indexOf(`${selector} {`);
  expect(start, `CSS block for ${selector}`).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf('}', start));
}

describe('theme registry', () => {
  it('has all four themes with unique ids and labels', () => {
    expect(THEMES.map(t => t.id)).toEqual(['default', 'graphite', 'ash', 'cosmos']);
    expect(new Set(THEMES.map(t => t.label)).size).toBe(4);
  });

  it('falls back to the default theme for unknown ids', () => {
    expect(getTheme(undefined).id).toBe('default');
    expect(getTheme('nope').id).toBe('default');
  });

  it('defines a complete xterm palette per theme', () => {
    for (const t of THEMES) {
      for (const [, key] of ANSI_KEYS) {
        expect((t.xterm as Record<string, unknown>)[key], `${t.id}.${key}`).toMatch(/^#[0-9a-fA-F]{6}$/);
      }
      expect(t.xterm.background).toMatch(/^#/);
      expect(t.xterm.foreground).toMatch(/^#/);
    }
  });

  it('keeps the CSS --ansi-* variables in sync with the xterm palettes', () => {
    for (const t of THEMES) {
      const block = themeBlock(t.id);
      for (const [code, key] of ANSI_KEYS) {
        const m = block.match(new RegExp(`--ansi-${code}:\\s*(#[0-9a-fA-F]{6})`));
        expect(m, `${t.id} --ansi-${code}`).toBeTruthy();
        expect(m![1].toLowerCase(), `${t.id} --ansi-${code} vs xterm.${key}`)
          .toBe((t.xterm as Record<string, string>)[key].toLowerCase());
      }
    }
  });

  it('defines the shiki token variables per theme', () => {
    const tokens = ['foreground', 'token-comment', 'token-keyword', 'token-string', 'token-constant', 'token-function', 'token-parameter', 'token-punctuation', 'token-link'];
    for (const t of THEMES) {
      const block = themeBlock(t.id);
      for (const token of tokens) {
        expect(block, `${t.id} --shiki-${token}`).toContain(`--shiki-${token}:`);
      }
    }
  });
});

describe('active theme store', () => {
  afterEach(() => setActiveTheme('default'));

  it('switches and notifies subscribers', () => {
    const seen: string[] = [];
    const unsub = subscribeTheme(t => seen.push(t.id));
    setActiveTheme('cosmos');
    expect(getActiveTheme().id).toBe('cosmos');
    setActiveTheme('cosmos'); // no-op, no duplicate notification
    setActiveTheme('graphite');
    unsub();
    setActiveTheme('ash');
    expect(seen).toEqual(['cosmos', 'graphite']);
  });
});

describe('ansiToHtml theming', () => {
  it('emits var(--ansi-N) for SGR 16-color codes', () => {
    expect(ansiToHtml('\x1b[31mred\x1b[0m')).toContain('color:var(--ansi-31)');
    expect(ansiToHtml('\x1b[92mok\x1b[0m')).toContain('color:var(--ansi-92)');
    expect(ansiToHtml('\x1b[44mbg\x1b[0m')).toContain('background:var(--ansi-bg-44)');
    expect(ansiToHtml('\x1b[105mbg\x1b[0m')).toContain('background:var(--ansi-bg-105)');
  });

  it('maps 256-color basic 16 onto the themed palette', () => {
    expect(ansiToHtml('\x1b[38;5;1mr\x1b[0m')).toContain('color:var(--ansi-31)');
    expect(ansiToHtml('\x1b[38;5;9mr\x1b[0m')).toContain('color:var(--ansi-91)');
  });

  it('keeps literal colors for the 256 cube and truecolor', () => {
    expect(ansiToHtml('\x1b[38;5;196mr\x1b[0m')).toContain('color:rgb(');
    expect(ansiToHtml('\x1b[38;2;10;20;30mr\x1b[0m')).toContain('color:rgb(10,20,30)');
  });
});
