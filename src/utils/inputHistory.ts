/**
 * Assemble the composer's up-arrow history. Entries must be retypeable
 * one-liners: blanks (STOP/^C and stdin writes produce empty-command
 * blocks) and multi-line framed AI prompts are dropped, and consecutive
 * duplicates collapse like bash's HISTCONTROL=ignoredups.
 *
 * Session history is built from block commands, and blocks recorded by older
 * versions (or hostile byte streams) can carry segmentation garbage: prompt
 * echoes ("user@host ~ ❯❯❯ ✘ 130 …"), PS2 continuation fragments
 * ("heredoc> print(1)"), or raw control bytes. None of those are commands a
 * user could retype, so they are filtered here rather than trusting every
 * historical source to be clean.
 */

const CONTROL_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;
// Prompt-theme glyphs that appear in echoed prompts, never in typed commands.
const PROMPT_GLYPH_RE = /[❯➜✘»⟫]/;
// zsh PS2 context fragments: "heredoc> …", "cmdand heredoc> …". A bare "> f"
// stays allowed — output truncation is a real command shape.
const PS2_FRAGMENT_RE = /^[a-z][a-z0-9]*(?: [a-z][a-z0-9]*){0,3}> /;
// A full prompt echo: user@host followed by a path-ish token and $/#/% .
const PROMPT_ECHO_RE = /^\S+@\S+[:\s]\s*\S*\s*[$#%]\s/;

function isRetypeable(entry: string): boolean {
  if (CONTROL_RE.test(entry)) return false;
  if (PROMPT_GLYPH_RE.test(entry)) return false;
  if (PS2_FRAGMENT_RE.test(entry)) return false;
  if (PROMPT_ECHO_RE.test(entry)) return false;
  return true;
}

export function assembleInputHistory(base: string[], session: string[]): string[] {
  const out: string[] = [];
  for (const entry of [...base, ...session]) {
    if (!entry || !entry.trim()) continue;
    if (entry.includes('\n')) continue;
    if (!isRetypeable(entry)) continue;
    if (out[out.length - 1] === entry) continue;
    out.push(entry);
  }
  return out;
}
