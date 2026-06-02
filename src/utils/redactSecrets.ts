// Secret redaction for text that leaves the machine — specifically anything
// fed into an AI provider's context (recent-activity push + the TerminalHistory
// MCP tool). Mirrors Warp's guarantee that secret redaction is applied
// unconditionally to all AI interactions.
//
// Pattern-based and necessarily best-effort: it favours catching common,
// high-signal credential shapes over exhaustiveness. Each pattern replaces the
// secret (not the whole line) with a visible placeholder so the AI still sees
// the surrounding context.

const PLACEHOLDER = '«redacted»';

interface SecretPattern {
  re: RegExp;
  // Replacement: either the placeholder, or a function preserving a prefix
  // (e.g. the variable name in `TOKEN=...`).
  replace: (match: string, ...groups: string[]) => string;
}

const PATTERNS: SecretPattern[] = [
  // PEM private-key blocks (multi-line). Must come first so its body isn't
  // partially eaten by base64-ish token patterns.
  {
    re: /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g,
    replace: () => PLACEHOLDER,
  },
  // AWS access key IDs.
  { re: /\b(?:AKIA|ASIA|AGPA|AIDA|AROA|ANPA|ANVA)[0-9A-Z]{16}\b/g, replace: () => PLACEHOLDER },
  // GitHub tokens (ghp_, gho_, ghu_, ghs_, ghr_, github_pat_).
  { re: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, replace: () => PLACEHOLDER },
  // Slack tokens.
  { re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, replace: () => PLACEHOLDER },
  // Google API keys.
  { re: /\bAIza[0-9A-Za-z\-_]{35}\b/g, replace: () => PLACEHOLDER },
  // OpenAI / Anthropic style keys.
  { re: /\b(?:sk|pk)-[A-Za-z0-9-_]{20,}\b/g, replace: () => PLACEHOLDER },
  // Authorization: Bearer <token> / Basic <token> — keep the scheme.
  {
    re: /\b(Authorization\s*[:=]\s*(?:Bearer|Basic|token)\s+)\S+/gi,
    replace: (_m, prefix) => `${prefix}${PLACEHOLDER}`,
  },
  // JWTs (three base64url segments).
  { re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, replace: () => PLACEHOLDER },
  // env-style assignments of sensitive-looking names — keep `NAME=`.
  {
    re: /\b([A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|API[_-]?KEY|ACCESS[_-]?KEY|PRIVATE[_-]?KEY|CREDENTIAL|AUTH)[A-Z0-9_]*)(\s*[:=]\s*)(["']?)([^\s"']{6,})\3/gi,
    replace: (_m, name, sep) => `${name}${sep}${PLACEHOLDER}`,
  },
];

export function redactSecrets(text: string): string {
  if (!text) return '';
  let out = text;
  for (const { re, replace } of PATTERNS) {
    out = out.replace(re, replace as (substring: string, ...args: unknown[]) => string);
  }
  return out;
}

export interface RedactableHistoryEntry {
  command: string;
  output?: string;
  exitCode?: number;
  cwd?: string;
  gitBranch?: string | null;
  durationMs?: number;
  timestamp?: number;
}

/** Returns a new array with secrets redacted from command/output fields. */
export function redactHistoryEntries<T extends RedactableHistoryEntry>(entries: T[]): T[] {
  return entries.map(e => ({
    ...e,
    command: redactSecrets(e.command),
    ...(e.output !== undefined ? { output: redactSecrets(e.output) } : {}),
  }));
}
