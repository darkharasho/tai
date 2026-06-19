// Matches the line TAI types to load its integration: a `.`/`source` builtin
// applied to our integration script. Anchored to the start so a real command
// that merely mentions the path (cat/vim/git tai-bash.sh) never matches.
const BOOTSTRAP_ECHO_RE =
  /^\s*(?:\.|source)\s+'?\S*(?:tai-bash\.sh|tai-zsh\.zsh|shell-integration\.(?:sh|zsh))'?\s*$/;

export function isBootstrapEchoLine(line: string): boolean {
  return BOOTSTRAP_ECHO_RE.test(line);
}
