# Predictive Commands P3 — Curated Completion Specs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add semantic Tab completion (subcommands, flags, descriptions) for ~15 common CLIs, falling back to the existing bash `compgen` for everything else.

**Architecture:** A data-only `CompletionSpec` per CLI feeds a pure `resolveCompletion` that walks the token stream and returns ranked candidates with descriptions. The composer's Tab handler tries the spec resolver first; on no spec / path-position token it defers to the existing `compgen` IPC (`pty.ts:317`, 50-result cap, 2s timeout).

**Tech Stack:** TypeScript, React, Vitest. Independent of P1/P2 (can ship in parallel).

## Global Constraints

- `npm test` only; keep suite green + `npx tsc --noEmit` clean. `@/` = `src/`.
- Specs are **plain data, no shell execution** → unit-testable without a shell.
- `compgen` remains the fallback for unknown commands and ALL path/file/dir completion — do not regress it.
- Named consts for caps. Commit after every task.

## File Structure

- `src/completions/types.ts` — `CompletionSpec`, `CompletionItem`, `CompletionResult`. New.
- `src/completions/resolveCompletion.ts` — pure resolver over a spec + token stream. New.
- `src/completions/specs/*.ts` — one file per CLI. New.
- `src/completions/registry.ts` — maps command name → spec. New.
- `src/components/TerminalInput.tsx` — Tab handler: resolver-first, compgen fallback; render descriptions. Modify.

---

### Task 1: Completion types + resolver

**Files:**
- Create: `src/completions/types.ts`, `src/completions/resolveCompletion.ts`
- Test: `tests/unit/resolveCompletion.test.ts`

**Interfaces:**
- Produces:
  - `interface CompletionItem { value: string; description?: string }`
  - `interface CompletionSpec { command: string; subcommands?: CompletionItem[] & { name?: string }[]; ... }` — concretely:
    ```ts
    interface SubcommandSpec { name: string; description?: string; subcommands?: SubcommandSpec[]; options?: OptionSpec[] }
    interface OptionSpec { names: string[]; description?: string; takesArg?: boolean }
    interface CompletionSpec { command: string; description?: string; subcommands?: SubcommandSpec[]; options?: OptionSpec[] }
    ```
  - `interface CompletionResult { items: CompletionItem[]; replaceToken: string }`
  - `resolveCompletion(spec: CompletionSpec, tokens: string[], lastToken: string): CompletionResult` — pure; tokens are the already-typed whole words, `lastToken` is the partial word being completed (may be '').
  - `tokenize(line: string): { tokens: string[]; lastToken: string }`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/resolveCompletion.test.ts
import { describe, it, expect } from 'vitest';
import { resolveCompletion, tokenize, CompletionSpec } from '@/completions/resolveCompletion';

const git: CompletionSpec = {
  command: 'git',
  subcommands: [
    { name: 'checkout', description: 'Switch branches' },
    { name: 'cherry-pick', description: 'Apply commits' },
    { name: 'commit', description: 'Record changes', options: [
      { names: ['-m', '--message'], description: 'Commit message', takesArg: true },
      { names: ['--amend'], description: 'Amend previous commit' },
    ] },
  ],
  options: [{ names: ['--version'], description: 'Print version' }],
};

describe('tokenize', () => {
  it('splits the line and isolates the partial last token', () => {
    expect(tokenize('git ch')).toEqual({ tokens: ['git'], lastToken: 'ch' });
    expect(tokenize('git commit ')).toEqual({ tokens: ['git', 'commit'], lastToken: '' });
  });
});

describe('resolveCompletion', () => {
  it('completes subcommands by prefix with descriptions', () => {
    const { tokens, lastToken } = tokenize('git ch');
    const r = resolveCompletion(git, tokens, lastToken);
    expect(r.items.map(i => i.value)).toEqual(['checkout', 'cherry-pick']);
    expect(r.items[0].description).toBe('Switch branches');
  });

  it('completes a subcommand-specific flag', () => {
    const { tokens, lastToken } = tokenize('git commit -');
    const r = resolveCompletion(git, tokens, lastToken);
    expect(r.items.map(i => i.value)).toEqual(expect.arrayContaining(['-m', '--message', '--amend']));
  });

  it('offers all subcommands when nothing typed after the command', () => {
    const { tokens, lastToken } = tokenize('git ');
    const r = resolveCompletion(git, tokens, lastToken);
    expect(r.items.map(i => i.value)).toEqual(['checkout', 'cherry-pick', 'commit']);
  });

  it('returns empty items at a positional/path token (defer to compgen)', () => {
    const { tokens, lastToken } = tokenize('git commit -m ');
    const r = resolveCompletion(git, tokens, lastToken);
    expect(r.items).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- resolveCompletion`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
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
  let node: SubcommandSpec | null = null;
  let prevToken = '';
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];
    prevToken = t;
    const match = subs.find((s) => s.name === t);
    if (match) {
      node = match;
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- resolveCompletion`
Expected: PASS (5 tests across the two describes).

- [ ] **Step 5: Verify suite + types**

Run: `npm test && npx tsc --noEmit`
Expected: PASS, clean.

- [ ] **Step 6: Commit**

```bash
git add src/completions/resolveCompletion.ts tests/unit/resolveCompletion.test.ts
git commit -m "feat(complete): completion spec types + pure resolver"
```

---

### Task 2: Initial spec set + registry

**Files:**
- Create: `src/completions/specs/{git,docker,npm,kubectl,cargo,gh,ssh,systemctl,brew,pnpm,yarn,make,go,python,curl}.ts` (start with git, docker, npm, kubectl, cargo — add the rest incrementally), `src/completions/registry.ts`
- Test: `tests/unit/completionRegistry.test.ts`

**Interfaces:**
- Consumes: `CompletionSpec` (Task 1).
- Produces: `getSpec(command: string): CompletionSpec | null`. Each spec is the default export of its file.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/completionRegistry.test.ts
import { describe, it, expect } from 'vitest';
import { getSpec } from '@/completions/registry';
import { resolveCompletion, tokenize } from '@/completions/resolveCompletion';

describe('completion registry', () => {
  it('returns a spec for git and resolves a real subcommand', () => {
    const spec = getSpec('git');
    expect(spec).toBeTruthy();
    const { tokens, lastToken } = tokenize('git ch');
    const items = resolveCompletion(spec!, tokens, lastToken).items.map(i => i.value);
    expect(items).toContain('checkout');
  });
  it('returns a spec for docker and npm', () => {
    expect(getSpec('docker')).toBeTruthy();
    expect(getSpec('npm')).toBeTruthy();
  });
  it('returns null for an unknown command', () => {
    expect(getSpec('frobnicate')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- completionRegistry`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create one spec per CLI (data only). Example `src/completions/specs/git.ts`:

```ts
import { CompletionSpec } from '@/completions/resolveCompletion';
const git: CompletionSpec = {
  command: 'git',
  subcommands: [
    { name: 'add', description: 'Stage changes' },
    { name: 'checkout', description: 'Switch branches or restore files' },
    { name: 'cherry-pick', description: 'Apply existing commits' },
    { name: 'commit', description: 'Record staged changes', options: [
      { names: ['-m', '--message'], description: 'Commit message', takesArg: true },
      { names: ['-a', '--all'], description: 'Stage tracked changes' },
      { names: ['--amend'], description: 'Amend the previous commit' },
    ] },
    { name: 'push', description: 'Update remote refs' },
    { name: 'pull', description: 'Fetch and integrate' },
    { name: 'status', description: 'Show working tree status' },
    { name: 'log', description: 'Show commit logs' },
    { name: 'branch', description: 'List/create/delete branches' },
    { name: 'rebase', description: 'Reapply commits on top of another base' },
    { name: 'stash', description: 'Stash changes' },
    { name: 'diff', description: 'Show changes' },
    { name: 'restore', description: 'Restore working tree files' },
    { name: 'switch', description: 'Switch branches' },
    { name: 'remote', description: 'Manage remotes' },
    { name: 'fetch', description: 'Download objects and refs' },
  ],
  options: [{ names: ['--version'], description: 'Print version' }, { names: ['--help'], description: 'Show help' }],
};
export default git;
```

Author the same shape for `docker`, `npm`, `kubectl`, `cargo` (top ~12 subcommands + common flags each — see each tool's `--help`). Then the registry:

```ts
// src/completions/registry.ts
import { CompletionSpec } from '@/completions/resolveCompletion';
import git from '@/completions/specs/git';
import docker from '@/completions/specs/docker';
import npm from '@/completions/specs/npm';
import kubectl from '@/completions/specs/kubectl';
import cargo from '@/completions/specs/cargo';

const SPECS: Record<string, CompletionSpec> = {
  git, docker, npm, kubectl, cargo,
};

export function getSpec(command: string): CompletionSpec | null {
  return SPECS[command] ?? null;
}
```

(Add more CLIs by creating a spec file and one registry line. Keep each spec ≤ ~80 lines.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- completionRegistry`
Expected: PASS (3 tests).

- [ ] **Step 5: Verify suite + types**

Run: `npm test && npx tsc --noEmit`
Expected: PASS, clean.

- [ ] **Step 6: Commit**

```bash
git add src/completions/specs src/completions/registry.ts tests/unit/completionRegistry.test.ts
git commit -m "feat(complete): initial CLI completion specs + registry"
```

---

### Task 3: Wire resolver-first Tab completion with compgen fallback

**Files:**
- Modify: `src/components/TerminalInput.tsx`
- Test: `tests/unit/completionWiring.test.ts`

**Interfaces:**
- Consumes: `getSpec` (Task 2), `tokenize`/`resolveCompletion` (Task 1), the existing `window.tai.pty.tabComplete(text, cwd)` IPC.
- Produces: `getSpecCompletions(line: string): CompletionItem[] | null` — pure helper: tokenize, look up the command's spec, resolve; returns `null` (→ caller falls back to compgen) when no spec or zero spec-driven items.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/completionWiring.test.ts
import { describe, it, expect } from 'vitest';
import { getSpecCompletions } from '@/components/TerminalInput';

describe('getSpecCompletions', () => {
  it('returns spec items for a known command', () => {
    const items = getSpecCompletions('git ch');
    expect(items?.map(i => i.value)).toContain('checkout');
  });
  it('returns null for an unknown command (→ compgen fallback)', () => {
    expect(getSpecCompletions('frobnicate --')).toBeNull();
  });
  it('returns null when the spec yields no items at a path position (→ compgen)', () => {
    expect(getSpecCompletions('git commit -m ')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- completionWiring`
Expected: FAIL — `getSpecCompletions` not exported.

- [ ] **Step 3: Implement helper + wire Tab handler**

In `TerminalInput.tsx`:

```ts
import { tokenize, resolveCompletion, CompletionItem } from '@/completions/resolveCompletion';
import { getSpec } from '@/completions/registry';

export function getSpecCompletions(line: string): CompletionItem[] | null {
  const { tokens, lastToken } = tokenize(line);
  if (tokens.length === 0) return null;
  const spec = getSpec(tokens[0]);
  if (!spec) return null;
  const items = resolveCompletion(spec, tokens, lastToken).items;
  return items.length > 0 ? items : null;
}
```

In the Tab handler (currently at ~line 160, the `else` branch that calls `window.tai.pty.tabComplete`): first try `const spec = getSpecCompletions(text);`. If non-null, populate the completion menu from `spec` (values + descriptions) using the SAME `tabCompletions`/`tabIndex` state, and skip the compgen call. If `null`, fall through to the existing `tabComplete(text, cwd)` path unchanged. The menu render (where `tabCompletions` is mapped, ~line 338) gains an optional description column — store items as `{value, description}` when spec-driven (a parallel `tabDescriptions` state keyed by index, or widen `tabCompletions` to `CompletionItem[]`; prefer widening to `CompletionItem[]` and adapting the compgen path to map plain strings to `{value}`).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- completionWiring`
Expected: PASS (3 tests).

- [ ] **Step 5: Verify suite + types**

Run: `npm test && npx tsc --noEmit`
Expected: PASS, clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/TerminalInput.tsx tests/unit/completionWiring.test.ts
git commit -m "feat(complete): spec-driven Tab completion with compgen fallback"
```

---

**▶ P3 checkpoint:** `npm test && npx tsc --noEmit`, then in-app: `git ch`<Tab> → menu shows `checkout`/`cherry-pick` with descriptions; `git commit -`<Tab> → `-m`/`--amend`; `somethingunknown `<Tab> → still falls back to compgen file/command completion; path completion (`cat ./sr`<Tab>) still works via compgen.

## Self-Review

- **Spec coverage:** lightweight data-only spec format → Task 1 types; resolver walking the token stream → Task 1; ~15 CLI specs + registry (start with 5, extensible one-line) → Task 2; resolver-first Tab with compgen fallback for unknown/path tokens, description column in menu → Task 3.
- **Placeholder scan:** real code throughout; "author the same shape for docker/npm/…" is concrete (each from the tool's `--help`), not a TODO — the registry + git spec are fully written and the pattern is mechanical.
- **Type consistency:** `CompletionSpec`/`SubcommandSpec`/`OptionSpec`/`CompletionItem`/`CompletionResult`, `tokenize`/`resolveCompletion`/`getSpec`/`getSpecCompletions` consistent across tasks.
