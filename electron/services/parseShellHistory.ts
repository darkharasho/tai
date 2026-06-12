/**
 * Shell history file parsing.
 *
 * Naively splitting a history file on newlines produces phantom "commands":
 * zsh stores multi-line entries (heredocs, loops) as one record whose interior
 * newlines are written as backslash-newline; bash with HISTTIMEFORMAT writes
 * `#<epoch>` comment lines between entries; and zsh "metafies" bytes >= 0x80
 * (0x83 marker + byte^0x20), which reads as mojibake if treated as UTF-8.
 */

const ZSH_EXT_RE = /^: \d+:\d+;(.*)$/;
const BASH_TIMESTAMP_RE = /^#\d{9,12}$/;

/** Undo zsh's metafication so multibyte characters decode correctly. */
export function unmetafyZsh(buf: Buffer): string {
  if (!buf.includes(0x83)) return buf.toString('utf8');
  const out = Buffer.alloc(buf.length);
  let j = 0;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x83 && i + 1 < buf.length) {
      out[j++] = buf[++i] ^ 0x20;
    } else {
      out[j++] = buf[i];
    }
  }
  return out.subarray(0, j).toString('utf8');
}

/**
 * Parse history file content (zsh extended or plain bash/zsh format) into
 * one string per executed command. Multi-line entries stay one entry, joined
 * with real newlines; bash timestamp comments are dropped.
 */
export function parseHistoryFile(content: string): string[] {
  const entries: string[] = [];
  let current: string | null = null;
  for (const rawLine of content.split('\n')) {
    let line = rawLine;
    // A trailing backslash marks "next line continues this entry" (zsh
    // multi-line records). An escaped backslash (`\\`) does not.
    let continues = false;
    if (line.endsWith('\\') && !line.endsWith('\\\\')) {
      continues = true;
      line = line.slice(0, -1);
    }
    if (current !== null) {
      current += '\n' + line;
    } else {
      if (line === '' || BASH_TIMESTAMP_RE.test(line)) continue;
      const m = line.match(ZSH_EXT_RE);
      current = m ? m[1] : line;
    }
    if (!continues) {
      if (current.trim()) entries.push(current);
      current = null;
    }
  }
  if (current !== null && current.trim()) entries.push(current);
  return entries;
}
