// src/completions/resolveCompletion.ts
export interface OptionSpec { names: string[]; description?: string; takesArg?: boolean }
export interface SubcommandSpec { name: string; description?: string; subcommands?: SubcommandSpec[]; options?: OptionSpec[] }
export interface CompletionSpec { command: string; description?: string; subcommands?: SubcommandSpec[]; options?: OptionSpec[] }
export interface CompletionItem { value: string; description?: string }
export interface CompletionResult { items: CompletionItem[]; replaceToken: string }

export function tokenize(line: string): { tokens: string[]; lastToken: string } {
  const endsWithSpace = /\s$/.test(line);
  const parts = line.trim().length ? line.trim().split(/\s+/) : [];
  if (endsWithSpace) return { tokens: parts, lastToken: '' };
  const lastToken = parts.pop() ?? '';
  return { tokens: parts, lastToken };
}

function byPrefix(items: CompletionItem[], prefix: string): CompletionItem[] {
  if (!prefix) return items;
  const p = prefix.toLowerCase();
  return items.filter((i) => i.value.toLowerCase().startsWith(p));
}

export function resolveCompletion(spec: CompletionSpec, tokens: string[], lastToken: string): CompletionResult {
  // tokens[0] is the command itself. Walk subcommands by the words after it.
  let subs = spec.subcommands ?? [];
  let opts = spec.options ?? [];
  let prevToken = '';
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];
    prevToken = t;
    const match = subs.find((s) => s.name === t);
    if (match) {
      subs = match.subcommands ?? [];
      opts = match.options ?? [];
    }
  }

  // After a flag that takes an argument → positional/path: defer to compgen.
  const flagWithArg = opts.find((o) => o.names.includes(prevToken) && o.takesArg);
  if (flagWithArg) return { items: [], replaceToken: lastToken };

  // Completing a flag.
  if (lastToken.startsWith('-')) {
    const flags: CompletionItem[] = opts.flatMap((o) =>
      o.names.map((n) => ({ value: n, description: o.description })));
    return { items: byPrefix(flags, lastToken), replaceToken: lastToken };
  }

  // Completing a subcommand (or first word after command).
  if (subs.length > 0) {
    const items: CompletionItem[] = subs.map((s) => ({ value: s.name, description: s.description }));
    return { items: byPrefix(items, lastToken), replaceToken: lastToken };
  }

  // No spec-driven candidates → positional/path: defer to compgen.
  return { items: [], replaceToken: lastToken };
}
