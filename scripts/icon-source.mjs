// Master source for the TAI app icon — "Double Chevron".
//
// Everything (app icon, .icns, .ico, tray templates, favicon) is generated from
// the geometry in this file. Nothing is hand-drawn downstream. Edit here, then
// run `npm run icons`.
//
// The mark is two chevrons on a squircle tile: the first in flat ink (your
// prompt), the second carrying the spectrum gradient (the model's reply).
//
// All geometry lives on a 200x200 grid.

const GRID = 200;

// --- palette ----------------------------------------------------------------

export const PALETTE = {
  tileDark: ['#31312F', '#0B0B0A'],
  tileLight: ['#FFFFFF', '#E4E1DA'],
  // Not pure black: on a near-white tile it out-weighs white-on-black.
  primaryOnDark: '#FFFFFF',
  primaryOnLight: '#1F1F1E',
  accent: [
    ['#FF4D6D', 0],
    ['#FFB03A', 0.26],
    ['#3DDC84', 0.52],
    ['#35B8FF', 0.78],
    ['#A06BFF', 1],
  ],
};

// Both tiles share one accent axis, running along the accent chevron's own
// diagonal, so red stays at the top on dark and light alike.
const ACCENT_AXIS = { x1: 98, y1: 44, x2: 154, y2: 158 };
const TILE_AXIS = { x1: 40, y1: 0, x2: 140, y2: 200 };

// --- geometry ---------------------------------------------------------------

// Three hand-tuned tiers rather than one path scaled down. Below ~32px the
// chevrons need to pull apart and thin out or the counter between them fills in.
// Each chevron is [startX, startY, apexX, apexY, endX, endY].
export const TIERS = {
  lg: { stroke: 21, primary: [52, 48, 98, 100, 52, 152], accent: [100, 48, 146, 100, 100, 152] },
  md: { stroke: 25, primary: [52, 52, 96, 100, 52, 148], accent: [104, 52, 148, 100, 104, 148] },
  xs: { stroke: 22, primary: [52, 56, 92, 100, 52, 144], accent: [108, 56, 148, 100, 108, 144] },
};

export function tierFor(size) {
  if (size >= 64) return 'lg';
  if (size >= 32) return 'md';
  return 'xs';
}

const chevron = (p) => `M${p[0]} ${p[1]} L${p[2]} ${p[3]} L${p[4]} ${p[5]}`;

// Superellipse (n=5) — the Big Sur squircle, not a rounded rect. A plain rx
// corner reads noticeably harder next to real macOS icons in the dock.
export function squirclePath(steps = 720) {
  const a = GRID / 2;
  const n = 5;
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * 2 * Math.PI;
    const c = Math.cos(t);
    const s = Math.sin(t);
    const x = a + a * Math.sign(c) * Math.abs(c) ** (2 / n);
    const y = a + a * Math.sign(s) * Math.abs(s) ** (2 / n);
    pts.push(`${x.toFixed(3)} ${y.toFixed(3)}`);
  }
  return `M${pts.join('L')}Z`;
}

// --- svg emitters -----------------------------------------------------------

const stops = () =>
  PALETTE.accent.map(([c, o]) => `<stop offset="${o * 100}%" stop-color="${c}"/>`).join('');

const linear = (id, axis, from, to) =>
  `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${axis.x1}" y1="${axis.y1}" x2="${axis.x2}" y2="${axis.y2}">` +
  `<stop offset="0%" stop-color="${from}"/><stop offset="100%" stop-color="${to}"/></linearGradient>`;

/**
 * The full app icon: squircle tile plus both chevrons.
 * @param {{variant?: 'dark'|'light', tier?: keyof TIERS}} opts
 */
export function renderIcon({ variant = 'dark', tier = 'lg' } = {}) {
  const g = TIERS[tier];
  const light = variant === 'light';
  const [tileFrom, tileTo] = light ? PALETTE.tileLight : PALETTE.tileDark;
  const primary = light ? PALETTE.primaryOnLight : PALETTE.primaryOnDark;
  const rim = light ? 'rgba(0,0,0,.11)' : 'rgba(255,255,255,.10)';
  const sq = squirclePath();

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${GRID} ${GRID}" width="${GRID}" height="${GRID}">
<defs>${linear('tile', TILE_AXIS, tileFrom, tileTo)}
<linearGradient id="accent" gradientUnits="userSpaceOnUse" x1="${ACCENT_AXIS.x1}" y1="${ACCENT_AXIS.y1}" x2="${ACCENT_AXIS.x2}" y2="${ACCENT_AXIS.y2}">${stops()}</linearGradient></defs>
<path d="${sq}" fill="url(#tile)"/>
<path d="${sq}" fill="none" stroke="${rim}" stroke-width="2.5"/>
<path d="${chevron(g.primary)}" fill="none" stroke="${primary}" stroke-width="${g.stroke}" stroke-linejoin="round" stroke-linecap="round"/>
<path d="${chevron(g.accent)}" fill="none" stroke="url(#accent)" stroke-width="${g.stroke}" stroke-linejoin="round" stroke-linecap="round"/>
</svg>`;
}

// Tray glyphs carry no tile behind them, so they need more stroke weight than
// the app icon at the same pixel size.
const TRAY_STROKE = 26;
const TRAY_TIER = 'md';

// Fraction of the canvas the mark itself occupies. A glyph cropped flush to its
// own bounding box reads oversized in a panel, because every neighbouring icon
// is drawn with an inset — matching that inset is what makes it sit level.
const TRAY_FILL = 0.74;

/**
 * Chevron glyph for menubar / tray icons, inset inside its canvas.
 *
 * With `accent` the second chevron takes the spectrum gradient, same as the app
 * icon — a mid-tone saturated stroke stays legible even when the surrounding
 * panel turns out to be the opposite of what the colour-scheme hint promised.
 * Flat mono (the default) is for macOS, whose template images must be a single
 * colour plus alpha for the OS to recolour them.
 *
 * @param {{color?: string, accent?: boolean}} opts
 */
export function renderGlyph({ color = '#000000', accent = false } = {}) {
  const g = TIERS[TRAY_TIER];
  const half = TRAY_STROKE / 2;
  // Bounding box of both stroked chevrons, squared off and then padded out.
  const xs = [...g.primary.filter((_, i) => i % 2 === 0), ...g.accent.filter((_, i) => i % 2 === 0)];
  const ys = [...g.primary.filter((_, i) => i % 2 === 1), ...g.accent.filter((_, i) => i % 2 === 1)];
  const minX = Math.min(...xs) - half;
  const minY = Math.min(...ys) - half;
  const w = Math.max(...xs) + half - minX;
  const h = Math.max(...ys) + half - minY;
  const mark = Math.max(w, h);
  const side = mark / TRAY_FILL;
  const ox = minX - (side - w) / 2;
  const oy = minY - (side - h) / 2;

  const defs = accent
    ? `<defs><linearGradient id="accent" gradientUnits="userSpaceOnUse" x1="${ACCENT_AXIS.x1}" y1="${ACCENT_AXIS.y1}" x2="${ACCENT_AXIS.x2}" y2="${ACCENT_AXIS.y2}">${stops()}</linearGradient></defs>\n`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${ox} ${oy} ${side} ${side}" width="${side}" height="${side}">
${defs}<path d="${chevron(g.primary)}" fill="none" stroke="${color}" stroke-width="${TRAY_STROKE}" stroke-linejoin="round" stroke-linecap="round"/>
<path d="${chevron(g.accent)}" fill="none" stroke="${accent ? 'url(#accent)' : color}" stroke-width="${TRAY_STROKE}" stroke-linejoin="round" stroke-linecap="round"/>
</svg>`;
}
