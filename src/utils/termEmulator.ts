/**
 * Minimal line-discipline terminal emulator.
 *
 * The block segmenter has to reconstruct "what the user saw" from raw PTY
 * bytes. Regex-stripping escapes is not enough: shells redraw the prompt and
 * echoed input with backspaces, \r, erase-line and cursor movement, and a
 * blind strip concatenates every redraw into garbage (duplicated prompts,
 * stray ^H/^G bytes, doubled command echoes). This models the subset of
 * terminal behavior that affects *text content* — cursor column/row, char
 * overwrite, erase — while tracking SGR (color) state per cell so output can
 * be re-serialized with colors intact for ansiToHtml.
 *
 * Deliberately NOT a full terminal: no scroll regions, no insert/delete
 * shifting, no wrapping (lines are unbounded). Alt-screen content never
 * reaches this class — the segmenter routes that to xterm.js.
 */

interface Line {
  chars: string[];
  sgrs: string[];
}

const MAX_PENDING_ESC = 8192;

// Compaction (opt-in): long-running sessions (pm2 logs, dev servers) stream
// for hours — keeping every line as live cell arrays is heavy, and
// re-serializing the whole buffer per chunk is O(N²) over the session.
// Lines old enough that no realistic cursor movement can touch them again
// freeze into plain strings; serialization cost per chunk becomes O(live
// window). Index-based APIs (textLines/cursorRow/…) are NOT compaction-aware
// — only enable compaction on instances consumed via text()/ansi()/tail*().
const COMPACT_AT = 1024;
const KEEP_LIVE = 700;
const FROZEN_MAX_LINES = 30_000;
const FROZEN_TRIM_TO = 20_000;

const MAX_CURSOR_ADVANCE = 10_000;
const MAX_LINE_OP = 10_000;
const MAX_COLS = 10_000;
export { MAX_CURSOR_ADVANCE, MAX_LINE_OP, MAX_COLS };

function nthNewline(s: string, n: number): number {
  let idx = -1;
  for (let i = 0; i < n; i++) {
    idx = s.indexOf('\n', idx + 1);
    if (idx === -1) return -1;
  }
  return idx;
}

export class TermEmulator {
  private _lines: Line[] = [{ chars: [], sgrs: [] }];
  private _row = 0;
  private _col = 0;
  private _sgr = '';
  // Carries an escape sequence split across feed() chunk boundaries.
  private _pending = '';
  private readonly _compactEnabled: boolean;
  // Compacted prefix: serialized once, each entry newline-terminated.
  private _frozenText = '';
  private _frozenAnsi = '';
  private _frozenCount = 0;

  constructor(opts?: { compact?: boolean }) {
    this._compactEnabled = !!opts?.compact;
  }

  reset(): void {
    this._lines = [{ chars: [], sgrs: [] }];
    this._row = 0;
    this._col = 0;
    this._sgr = '';
    this._pending = '';
    this._frozenText = '';
    this._frozenAnsi = '';
    this._frozenCount = 0;
  }

  /** Number of lines currently in the buffer (cursor line included). */
  get lineCount(): number { return this._lines.length; }
  /** Row index of the cursor — the line currently being (re)written. */
  get cursorRow(): number { return this._row; }

  feed(chunk: string): void {
    const s = this._pending + chunk;
    this._pending = '';
    let i = 0;
    const len = s.length;
    while (i < len) {
      const ch = s[i];
      if (ch === '\x1b') {
        const consumed = this._handleEscape(s, i);
        if (consumed === -1) {
          // Incomplete sequence at the end of the chunk — stash for next feed.
          this._pending = s.slice(i);
          if (this._pending.length > MAX_PENDING_ESC) this._pending = '';
          return;
        }
        i += consumed;
        continue;
      }
      if (ch === '\r') { this._col = 0; i++; continue; }
      if (ch === '\n') { this._newline(); i++; continue; }
      if (ch === '\b') { this._col = Math.max(0, this._col - 1); i++; continue; }
      if (ch === '\t') {
        const stop = (Math.floor(this._col / 8) + 1) * 8;
        while (this._col < stop) this._write(' ');
        i++;
        continue;
      }
      const code = ch.charCodeAt(0);
      if (code < 0x20 || code === 0x7f) { i++; continue; }
      // Keep surrogate pairs atomic so emoji/astral glyphs survive overwrite.
      if (code >= 0xd800 && code <= 0xdbff && i + 1 < len) {
        this._write(ch + s[i + 1]);
        i += 2;
        continue;
      }
      this._write(ch);
      i++;
    }
    if (this._compactEnabled) this._maybeCompact();
  }

  private _maybeCompact(): void {
    if (this._lines.length <= COMPACT_AT) return;
    // Never freeze the cursor line or anything below it.
    const freezeEnd = Math.min(this._lines.length - KEEP_LIVE, this._row);
    if (freezeEnd <= 0) return;
    const frozen = this._lines.splice(0, freezeEnd);
    for (const l of frozen) {
      this._frozenText += l.chars.join('').replace(/\s+$/, '') + '\n';
      this._frozenAnsi += this._serializeLine(l) + '\n';
    }
    this._frozenCount += freezeEnd;
    this._row -= freezeEnd;
    if (this._frozenCount > FROZEN_MAX_LINES) this._trimFrozen();
  }

  private _trimFrozen(): void {
    const drop = this._frozenCount - FROZEN_TRIM_TO;
    const tIdx = nthNewline(this._frozenText, drop);
    const aIdx = nthNewline(this._frozenAnsi, drop);
    if (tIdx === -1 || aIdx === -1) return;
    const marker = `… (${drop} earlier lines trimmed)\n`;
    this._frozenText = marker + this._frozenText.slice(tIdx + 1);
    this._frozenAnsi = marker + this._frozenAnsi.slice(aIdx + 1);
    this._frozenCount = FROZEN_TRIM_TO + 1;
  }

  /** Plain text of the whole buffer, line-trailing whitespace trimmed. */
  text(): string {
    return this._frozenText + this._lines.map(l => l.chars.join('').replace(/\s+$/, '')).join('\n');
  }

  /** Buffer with SGR color runs re-serialized for ansiToHtml. */
  ansi(): string {
    return this._frozenAnsi + this._lines.map(l => this._serializeLine(l)).join('\n');
  }

  /**
   * Last `n` lines as plain text — O(n) regardless of buffer size as long as
   * `n` fits inside the live window (callers keep n < KEEP_LIVE).
   */
  tailText(n: number): string {
    if (this._frozenCount > 0 && this._lines.length < n) {
      return this.text().split('\n').slice(-n).join('\n');
    }
    return this._lines.slice(-n).map(l => l.chars.join('').replace(/\s+$/, '')).join('\n');
  }

  /** Last `n` lines with SGR runs — same windowing contract as tailText. */
  tailAnsi(n: number): string {
    if (this._frozenCount > 0 && this._lines.length < n) {
      return this.ansi().split('\n').slice(-n).join('\n');
    }
    return this._lines.slice(-n).map(l => this._serializeLine(l)).join('\n');
  }

  /** Plain lines; trailing whitespace trimmed unless trim=false. */
  textLines(trim = true): string[] {
    return this._lines.map(l => trim ? l.chars.join('').replace(/\s+$/, '') : l.chars.join(''));
  }

  /** Plain text without per-line trailing-whitespace trimming (prompts keep their trailing space). */
  textUntrimmed(): string {
    return this._lines.map(l => l.chars.join('')).join('\n');
  }

  /** True when nothing has been written since construction/reset. */
  isEmpty(): boolean {
    return this._frozenCount === 0 && this._lines.length === 1 && this._lines[0].chars.length === 0;
  }

  ansiLines(): string[] {
    return this._lines.map(l => this._serializeLine(l));
  }

  /** The line under the cursor, untrimmed — prompt detection needs the trailing space. */
  currentLine(): string {
    return this._lines[this._row]?.chars.join('') ?? '';
  }

  /** All lines above the cursor, joined — the "complete" portion of the stream. */
  completedText(): string {
    return this._lines.slice(0, this._row).map(l => l.chars.join('').replace(/\s+$/, '')).join('\n');
  }

  /**
   * Keep only the first line (the command echo) and park the cursor on a
   * fresh second line. Used when a TUI takes over mid-block and the
   * accumulated redraw noise should be discarded.
   */
  truncateAfterFirstLine(): void {
    this._lines = [this._lines[0] ?? { chars: [], sgrs: [] }, { chars: [], sgrs: [] }];
    this._row = 1;
    this._col = 0;
  }

  private _line(): Line {
    while (this._lines.length <= this._row) this._lines.push({ chars: [], sgrs: [] });
    return this._lines[this._row];
  }

  private _newline(): void {
    this._row++;
    this._col = 0;
    this._line();
  }

  private _write(ch: string): void {
    const line = this._line();
    while (line.chars.length < this._col) {
      line.chars.push(' ');
      line.sgrs.push('');
    }
    line.chars[this._col] = ch;
    line.sgrs[this._col] = this._sgr;
    this._col++;
  }

  /**
   * Handle the escape sequence starting at s[start] ('\x1b'). Returns the
   * number of chars consumed, or -1 if the sequence is incomplete.
   */
  private _handleEscape(s: string, start: number): number {
    const next = s[start + 1];
    if (next === undefined) return -1;

    if (next === '[') {
      // CSI: params/intermediates 0x20–0x3f, final byte 0x40–0x7e.
      let j = start + 2;
      while (j < s.length) {
        const c = s.charCodeAt(j);
        if (c >= 0x40 && c <= 0x7e) {
          this._handleCsi(s.slice(start + 2, j), s[j]);
          return j - start + 1;
        }
        if (c < 0x20 || c > 0x3f) return j - start; // malformed — drop what we scanned
        j++;
      }
      return -1;
    }

    if (next === ']' || next === 'P' || next === 'X' || next === '^' || next === '_') {
      // OSC / DCS / SOS / PM / APC — swallow through BEL or ST.
      for (let j = start + 2; j < s.length; j++) {
        if (s[j] === '\x07') return j - start + 1;
        if (s[j] === '\x1b' && s[j + 1] === '\\') return j - start + 2;
      }
      return -1;
    }

    if (next === '(' || next === ')') {
      return s.length > start + 2 ? 3 : -1; // charset designation
    }

    return 2; // single-char escape (ESC =, ESC >, ESC M, ...)
  }

  private _handleCsi(params: string, final: string): void {
    if (params.startsWith('?') || params.startsWith('>') || params.startsWith('=')) return; // private modes
    const nums = params.split(';').map(p => parseInt(p, 10));
    const n = Number.isFinite(nums[0]) ? nums[0] : undefined;
    switch (final) {
      case 'm':
        this._applySgr(params);
        break;
      case 'K': {
        const line = this._line();
        const mode = n ?? 0;
        if (mode === 0) {
          line.chars.length = Math.min(line.chars.length, this._col);
          line.sgrs.length = line.chars.length;
        } else if (mode === 1) {
          for (let c = 0; c < Math.min(this._col, line.chars.length); c++) {
            line.chars[c] = ' ';
            line.sgrs[c] = '';
          }
        } else if (mode === 2) {
          line.chars = [];
          line.sgrs = [];
        }
        break;
      }
      case 'J': {
        const mode = n ?? 0;
        if (mode === 2 || mode === 3) {
          this._lines = [{ chars: [], sgrs: [] }];
          this._row = 0;
          this._col = 0;
        } else if (mode === 0) {
          this._lines.length = this._row + 1;
          const line = this._line();
          line.chars.length = Math.min(line.chars.length, this._col);
          line.sgrs.length = line.chars.length;
        }
        break;
      }
      case 'A': this._row = Math.max(0, this._row - (n || 1)); break;
      case 'B': this._row += Math.min(n || 1, MAX_CURSOR_ADVANCE); this._line(); break;
      case 'C': this._col = Math.min(this._col + (n || 1), MAX_COLS); break;
      case 'D': this._col = Math.max(0, this._col - (n || 1)); break;
      case 'E': this._row += Math.min(n || 1, MAX_CURSOR_ADVANCE); this._col = 0; this._line(); break;
      case 'F': this._row = Math.max(0, this._row - (n || 1)); this._col = 0; break;
      case 'G': this._col = Math.max(0, Math.min((n || 1) - 1, MAX_COLS)); break;
      case 'd': this._row = Math.max(0, (n || 1) - 1); this._line(); break;
      case 'H':
      case 'f': {
        this._row = Math.max(0, (n || 1) - 1);
        const col = Number.isFinite(nums[1]) ? nums[1] : 1;
        this._col = Math.max(0, Math.min((col || 1) - 1, MAX_COLS));
        this._line();
        break;
      }
      case '@': { // ICH — insert blank characters at the cursor
        const line = this._line();
        if (this._col < line.chars.length) {
          const blanks = Array.from({ length: n || 1 }, () => ' ');
          line.chars.splice(this._col, 0, ...blanks);
          line.sgrs.splice(this._col, 0, ...blanks.map(() => ''));
        }
        break;
      }
      case 'P': { // DCH — delete characters at the cursor, pulling the rest left
        const line = this._line();
        line.chars.splice(this._col, n || 1);
        line.sgrs.splice(this._col, n || 1);
        break;
      }
      case 'X': { // ECH — erase characters (blank, no shift)
        const line = this._line();
        const end = Math.min(line.chars.length, this._col + (n || 1));
        for (let c = this._col; c < end; c++) {
          line.chars[c] = ' ';
          line.sgrs[c] = '';
        }
        break;
      }
      case 'L': { // IL — insert blank lines at the cursor row
        const count = Math.min(n || 1, MAX_LINE_OP);
        const blanks = Array.from({ length: count }, () => ({ chars: [] as string[], sgrs: [] as string[] }));
        this._lines.splice(this._row, 0, ...blanks);
        break;
      }
      case 'M': { // DL — delete lines at the cursor row
        this._lines.splice(this._row, Math.min(n || 1, MAX_LINE_OP));
        this._line();
        break;
      }
      default:
        break; // ignore everything else (scroll regions etc.)
    }
  }

  private _applySgr(params: string): void {
    if (params === '' || params === '0') {
      this._sgr = '';
      return;
    }
    const parts = params.split(';');
    let acc = this._sgr ? this._sgr.split(';') : [];
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i] === '' ? '0' : parts[i];
      const code = parseInt(p, 10);
      if (!Number.isFinite(code)) continue;
      if (code === 0) {
        acc = [];
      } else if (code === 38 || code === 48) {
        const mode = parts[i + 1];
        if (mode === '5' && parts[i + 2] !== undefined) {
          acc.push(p, parts[i + 1], parts[i + 2]);
          i += 2;
        } else if (mode === '2' && parts[i + 4] !== undefined) {
          acc.push(p, parts[i + 1], parts[i + 2], parts[i + 3], parts[i + 4]);
          i += 4;
        }
      } else {
        acc.push(p);
      }
    }
    this._sgr = acc.join(';');
  }

  private _serializeLine(line: Line): string {
    // Trim trailing unstyled whitespace (padding artifacts).
    let end = line.chars.length;
    while (end > 0 && line.chars[end - 1] === ' ' && line.sgrs[end - 1] === '') end--;
    let out = '';
    let cur = '';
    for (let c = 0; c < end; c++) {
      const sgr = line.sgrs[c];
      if (sgr !== cur) {
        if (cur !== '') out += '\x1b[0m';
        if (sgr !== '') out += `\x1b[${sgr}m`;
        cur = sgr;
      }
      out += line.chars[c];
    }
    if (cur !== '') out += '\x1b[0m';
    return out;
  }
}

/** One-shot: render a raw byte string to the plain text a terminal would show. */
export function renderTermText(raw: string): string {
  const emu = new TermEmulator();
  emu.feed(raw);
  return emu.text();
}

/** One-shot: render raw bytes to text with SGR color runs preserved. */
export function renderTermAnsi(raw: string): string {
  const emu = new TermEmulator();
  emu.feed(raw);
  return emu.ansi();
}
