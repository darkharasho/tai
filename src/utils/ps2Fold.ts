/**
 * Multi-line command reassembly.
 *
 * When a multi-line command (loop, heredoc, pipeline continuation) is typed
 * or pasted, the shell echoes each continuation line behind a PS2 prompt:
 * bash uses `> `, zsh renders its parser context like `heredoc> ` or
 * `cmdand heredoc> `. Without shell integration those echo lines land in the
 * block's *output*, mangling the card. These helpers fold them back into a
 * clean multi-line command.
 */

// zsh PS2 is `%_> `: one or more lowercase context words, then `> `.
// bash PS2 is a bare `> `. Cap word length so table-ish output can't match.
// `>` at end-of-line also counts: completed lines arrive end-trimmed, so an
// empty continuation echoes as just `heredoc>`.
const PS2_RE = /^(?:[a-z][a-z0-9]{0,15}(?: [a-z][a-z0-9]{0,15}){0,3} ?)?>( |$)/;

const HEREDOC_RE = /<<-?\s*(['"]?)(\w+)\1/g;

/**
 * True when `cmd` is not a complete shell command — an unclosed heredoc,
 * quote, bracket or compound statement, or a trailing continuation operator.
 * Heuristic: used only to decide whether PS2-looking output lines should be
 * folded into the command, so false negatives just leave output untouched.
 */
export function isIncompleteCommand(cmd: string): boolean {
  if (/(\\|&&|\|\||\|)\s*$/.test(cmd)) return true;

  // Unterminated heredoc: a `<<DELIM` whose delimiter never appears alone on
  // a later line.
  HEREDOC_RE.lastIndex = 0;
  const lines = cmd.split('\n');
  let m: RegExpExecArray | null;
  while ((m = HEREDOC_RE.exec(cmd)) !== null) {
    const delim = m[2];
    const opensAt = cmd.slice(0, m.index).split('\n').length - 1;
    const closed = lines.slice(opensAt + 1).some(l => l.trim() === delim);
    if (!closed) return true;
  }

  // Unbalanced quotes / brackets / compound keywords. A cheap scanner that
  // ignores quoted content for bracket and keyword counting.
  let sq = false, dq = false, depth = 0;
  let bare = '';
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];
    if (ch === '\\' && !sq) { i++; bare += '  '; continue; }
    if (sq) { if (ch === "'") sq = false; bare += ' '; continue; }
    if (dq) { if (ch === '"') dq = false; bare += ' '; continue; }
    if (ch === "'") { sq = true; bare += ' '; continue; }
    if (ch === '"') { dq = true; bare += ' '; continue; }
    if (ch === '(' || ch === '{' || ch === '[') depth++;
    else if (ch === ')' || ch === '}' || ch === ']') depth--;
    bare += ch;
  }
  if (sq || dq || depth > 0) return true;

  const count = (re: RegExp) => (bare.match(re) ?? []).length;
  if (count(/\bdo\b/g) > count(/\bdone\b/g)) return true;
  if (count(/\bif\b/g) > count(/\bfi\b/g)) return true;
  if (count(/\bcase\b/g) > count(/\besac\b/g)) return true;

  return false;
}

/** Strip a single PS2 prefix from a continuation line, if present. */
export function stripPs2(line: string): string {
  const m = line.match(PS2_RE);
  return m ? line.slice(m[0].length) : line;
}

/**
 * Fold leading PS2 continuation-echo lines from `outputLines` into `command`.
 * Mutates nothing; returns the folded command and the remaining output lines.
 */
export function foldPs2Continuations(
  command: string,
  outputLines: string[],
  rawOutputLines: string[],
): { command: string; outputLines: string[]; rawOutputLines: string[] } {
  let i = 0;
  let cmd = command;
  while (i < outputLines.length && isIncompleteCommand(cmd)) {
    const m = outputLines[i].match(PS2_RE);
    if (!m) break;
    cmd += '\n' + outputLines[i].slice(m[0].length);
    i++;
  }
  if (i === 0) return { command, outputLines, rawOutputLines };
  return { command: cmd, outputLines: outputLines.slice(i), rawOutputLines: rawOutputLines.slice(i) };
}
