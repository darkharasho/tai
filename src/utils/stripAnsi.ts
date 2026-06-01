const ANSI_RE = /\x1b\[[?>=!]?[0-9;]*[A-Za-z~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[P^_X][^\x1b]*\x1b\\|\x1b\([A-Z]|\x1b[A-Za-z=>]|\r(?=\n)/g;

// Match cursor-to-column-1 escapes that readline (Python, node REPL, etc.)
// uses instead of a bare \r when redrawing the input line:
//   ESC [ G        (move cursor to col 1 — default)
//   ESC [ 0 G      (same)
//   ESC [ 1 G      (same)
// We rewrite these to \r before stripping other ANSI so the per-line CR
// collapse (applyCR in BlockSegmenter) still sees a redraw marker.
const CURSOR_COL1_RE = /\x1b\[[01]?G/g;

export function stripAnsi(str: string): string {
  return str.replace(CURSOR_COL1_RE, '\r').replace(ANSI_RE, '');
}
