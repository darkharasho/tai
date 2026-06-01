const ANSI_RE = /\x1b\[[?>=!]?[0-9;]*[A-Za-z~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[P^_X][^\x1b]*\x1b\\|\x1b\([A-Z]|\x1b[A-Za-z=>]|\r(?=\n)/g;

// Cursor-positioning escapes that readline-style REPLs emit instead of a
// bare \r when redrawing the prompt + input line. We rewrite each of these
// to \r before stripping other ANSI, so the per-line CR collapse (applyCR
// in BlockSegmenter) still sees a redraw marker and the iterations collapse
// instead of piling up as visible text.
//
//   ESC [ G / [0G / [1G   — cursor to column 1 (node REPL, Ink)
//   ESC [ <n>D where n>=2 — cursor back N columns (Python pyrepl / readline;
//                           N matches "back to col 0" for the current line).
//                           n=1 (single backspace) is left as a normal CSI
//                           strip — collapsing on every n=1 would mangle
//                           legitimate in-line edits.
const CURSOR_REDRAW_RE = /\x1b\[(?:[01]?G|(?:[2-9]|\d{2,})D)/g;

/**
 * Rewrite cursor-redraw escapes to \r, preserving all other ANSI (color,
 * styling, alt-screen) intact. Use this on RAW byte buffers that need to
 * keep their color codes for downstream ansiToHtml rendering, but still
 * need the per-line CR collapse to work.
 */
export function normalizeCursorRedraws(str: string): string {
  return str.replace(CURSOR_REDRAW_RE, '\r');
}

export function stripAnsi(str: string): string {
  return normalizeCursorRedraws(str).replace(ANSI_RE, '');
}
