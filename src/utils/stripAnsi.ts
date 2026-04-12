const ANSI_RE = /\x1b\[[?>=!]?[0-9;]*[A-Za-z~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[P^_X][^\x1b]*\x1b\\|\x1b\([A-Z]|\x1b[A-Za-z=>]|\r/g;

export function stripAnsi(str: string): string {
  return str.replace(ANSI_RE, '');
}
