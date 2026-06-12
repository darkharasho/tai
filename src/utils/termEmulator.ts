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

export class TermEmulator {
  private _lines: Line[] = [{ chars: [], sgrs: [] }];
  private _row = 0;
  private _col = 0;
  private _sgr = '';
  // Carries an escape sequence split across feed() chunk boundaries.
  private _pending = '';

  reset(): void {
    this._lines = [{ chars: [], sgrs: [] }];
    this._row = 0;
    this._col = 0;
    this._sgr = '';
    this._pending = '';
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
  }

  /** Plain text of the whole buffer, line-trailing whitespace trimmed. */
  text(): string {
    return this._lines.map(l => l.chars.join('').replace(/\s+$/, '')).join('\n');
  }

  /** Buffer with SGR color runs re-serialized for ansiToHtml. */
  ansi(): string {
    return this._lines.map(l => this._serializeLine(l)).join('\n');
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
    return this._lines.length === 1 && this._lines[0].chars.length === 0;
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
      case 'B': this._row += (n || 1); this._line(); break;
      case 'C': this._col += (n || 1); break;
      case 'D': this._col = Math.max(0, this._col - (n || 1)); break;
      case 'E': this._row += (n || 1); this._col = 0; this._line(); break;
      case 'F': this._row = Math.max(0, this._row - (n || 1)); this._col = 0; break;
      case 'G': this._col = Math.max(0, (n || 1) - 1); break;
      case 'd': this._row = Math.max(0, (n || 1) - 1); this._line(); break;
      case 'H':
      case 'f': {
        this._row = Math.max(0, (n || 1) - 1);
        const col = Number.isFinite(nums[1]) ? nums[1] : 1;
        this._col = Math.max(0, (col || 1) - 1);
        this._line();
        break;
      }
      default:
        break; // ignore everything else (insert/delete/scroll)
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
