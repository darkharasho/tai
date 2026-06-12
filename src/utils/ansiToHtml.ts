const ANSI_COLORS: Record<number, string> = {
  30: '#0c0f11', 31: '#E35535', 32: '#00a884', 33: '#c7910c',
  34: '#11B7D4', 35: '#d46ec0', 36: '#38c7bd', 37: '#bec6d0',
  90: '#5a6a7a', 91: '#E35535', 92: '#00a884', 93: '#f5b832',
  94: '#11B7D4', 95: '#a85ff1', 96: '#38c7bd', 97: '#ffffff',
};

const ANSI_BG_COLORS: Record<number, string> = {
  40: '#0c0f11', 41: '#3a1510', 42: '#0a3028', 43: '#3a2e0a',
  44: '#0a2a35', 45: '#35203a', 46: '#0a3530', 47: '#3a4048',
  100: '#3a4048', 101: '#4a2018', 102: '#143a30', 103: '#4a3a15',
  104: '#153545', 105: '#3a2845', 106: '#154540', 107: '#5a6a7a',
};

const SGR_RE = /\x1b\[([0-9;]*)m/g;
const OTHER_ESC_RE = /\x1b\[[?>=!]?[0-9;]*[A-LN-Za-ln-z~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[P^_X][^\x1b]*\x1b\\|\x1b\([A-Z]|\x1b[A-Za-z=>]|\r/g;

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function parse256Color(codes: number[], i: number): { color: string | null; consumed: number } {
  if (codes[i + 1] === 5 && codes[i + 2] != null) {
    const n = codes[i + 2];
    if (n < 16) {
      const basic = [
        '#0c0f11','#E35535','#00a884','#c7910c','#11B7D4','#d46ec0','#38c7bd','#bec6d0',
        '#5a6a7a','#E35535','#00a884','#f5b832','#11B7D4','#a85ff1','#38c7bd','#ffffff',
      ];
      return { color: basic[n], consumed: 3 };
    }
    if (n < 232) {
      const idx = n - 16;
      const r = Math.floor(idx / 36) * 51;
      const g = Math.floor((idx % 36) / 6) * 51;
      const b = (idx % 6) * 51;
      return { color: `rgb(${r},${g},${b})`, consumed: 3 };
    }
    const gray = 8 + (n - 232) * 10;
    return { color: `rgb(${gray},${gray},${gray})`, consumed: 3 };
  }
  if (codes[i + 1] === 2 && codes[i + 4] != null) {
    return { color: `rgb(${codes[i + 2]},${codes[i + 3]},${codes[i + 4]})`, consumed: 5 };
  }
  return { color: null, consumed: 1 };
}

export function ansiToHtml(raw: string): string {
  // Residual C0 control bytes (BEL, backspace, …) render as tofu glyphs in
  // HTML — they carry no visual meaning here, so drop them outright.
  const cleaned = raw
    .replace(OTHER_ESC_RE, '')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1a\x1c-\x1f\x7f]/g, '');

  let fg: string | null = null;
  let bg: string | null = null;
  let bold = false;
  let dim = false;
  let italic = false;
  let underline = false;
  let result = '';
  let lastIndex = 0;

  let match: RegExpExecArray | null;
  SGR_RE.lastIndex = 0;

  while ((match = SGR_RE.exec(cleaned)) !== null) {
    const text = cleaned.slice(lastIndex, match.index);
    if (text) result += wrapSpan(escapeHtml(text), fg, bg, bold, dim, italic, underline);
    lastIndex = SGR_RE.lastIndex;

    const codes = (match[1] || '0').split(';').map(Number);
    for (let i = 0; i < codes.length; i++) {
      const c = codes[i];
      if (c === 0) { fg = null; bg = null; bold = false; dim = false; italic = false; underline = false; }
      else if (c === 1) bold = true;
      else if (c === 2) dim = true;
      else if (c === 3) italic = true;
      else if (c === 4) underline = true;
      else if (c === 22) { bold = false; dim = false; }
      else if (c === 23) italic = false;
      else if (c === 24) underline = false;
      else if (c === 39) fg = null;
      else if (c === 49) bg = null;
      else if (ANSI_COLORS[c]) fg = ANSI_COLORS[c];
      else if (ANSI_BG_COLORS[c]) bg = ANSI_BG_COLORS[c];
      else if (c === 38) { const r = parse256Color(codes, i); fg = r.color; i += r.consumed - 1; }
      else if (c === 48) { const r = parse256Color(codes, i); bg = r.color; i += r.consumed - 1; }
    }
  }

  const tail = cleaned.slice(lastIndex);
  if (tail) result += wrapSpan(escapeHtml(tail), fg, bg, bold, dim, italic, underline);

  return linkify(result);
}

const URL_RE = /(https?:\/\/[^\s<>"'`)\]]+)/g;

function linkify(html: string): string {
  return html.replace(URL_RE, (url) => {
    const clean = url.replace(/[.,;:!?)]+$/, '');
    const trailing = url.slice(clean.length);
    return `<a class="cb-link" href="${clean}" title="Ctrl+Click to open" data-url="${clean}">${clean}</a>${trailing}`;
  });
}

function wrapSpan(
  text: string,
  fg: string | null, bg: string | null,
  bold: boolean, dim: boolean, italic: boolean, underline: boolean,
): string {
  if (!fg && !bg && !bold && !dim && !italic && !underline) return text;

  let style = '';
  if (fg) style += `color:${fg};`;
  if (bg) style += `background:${bg};`;
  if (bold) style += 'font-weight:700;';
  if (dim) style += 'opacity:0.6;';
  if (italic) style += 'font-style:italic;';
  if (underline) style += 'text-decoration:underline;';

  return `<span style="${style}">${text}</span>`;
}
