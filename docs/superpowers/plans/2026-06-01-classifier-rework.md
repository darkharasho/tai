# Input Classifier Rework (P1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the boolean `looksLikeShellCommand` with a probabilistic `classifyInput(input, ctx?) → { type, confidence, source }`, then gate `TerminalInput`'s live mode-flip on confidence so ambiguous half-typed input stops thrashing.

**Architecture:** `src/utils/commandDetector.ts` is rewritten into an ordered decision pipeline that returns a type + synthesized confidence (HIGH/MED/LOW) + decision source. `looksLikeShellCommand` becomes a thin boolean wrapper so all existing callers/tests are unaffected. `TerminalInput.tsx` calls `classifyInput` with the current mode and only flips when `confidence >= FLIP_THRESHOLD`.

**Tech Stack:** TypeScript, React, Vitest. Spec: `docs/superpowers/specs/2026-06-01-classifier-rework-design.md`.

---

## File Structure

- **Modify (rewrite)** `src/utils/commandDetector.ts` — add `classifyInput`, types, confidence/threshold constants; reimplement `looksLikeShellCommand` as a wrapper. Preserve all existing keyword/word data sets verbatim.
- **Modify** `tests/unit/commandDetector.test.ts` — keep all existing cases; add a `classifyInput` describe block.
- **Modify** `src/components/TerminalInput.tsx:240-256` — confidence-gated flip.

---

## Task 1: Probabilistic `classifyInput`

**Files:**
- Modify: `src/utils/commandDetector.ts`
- Test: `tests/unit/commandDetector.test.ts`

- [ ] **Step 1: Add the failing `classifyInput` tests**

Append this describe block to `tests/unit/commandDetector.test.ts` (keep the existing `looksLikeShellCommand` describe block exactly as-is):

```ts
import { classifyInput, CONFIDENCE, FLIP_THRESHOLD } from '@/utils/commandDetector';

describe('classifyInput', () => {
  it('flags wrapped agent CLIs as high-confidence shell', () => {
    const r = classifyInput('claude how do I fix this');
    expect(r.type).toBe('shell');
    expect(r.confidence).toBe(CONFIDENCE.HIGH);
    expect(r.source).toBe('agent-cli');
  });

  it('flags explicit shell syntax as high-confidence shell', () => {
    expect(classifyInput('cat f | grep x').source).toBe('shell-syntax');
    expect(classifyInput('./run.sh').source).toBe('shell-syntax');
    expect(classifyInput('NODE_ENV=prod npm start').source).toBe('shell-syntax');
    expect(classifyInput('tool --verbose').source).toBe('shell-syntax');
    expect(classifyInput('cat f | grep x').type).toBe('shell');
    expect(classifyInput('cat f | grep x').confidence).toBe(CONFIDENCE.HIGH);
  });

  it('flags a question mark as high-confidence ai', () => {
    const r = classifyInput('is this a bug?');
    expect(r.type).toBe('ai');
    expect(r.confidence).toBe(CONFIDENCE.HIGH);
    expect(r.source).toBe('question-mark');
  });

  it('flags a known command as high-confidence shell', () => {
    const r = classifyInput('git status');
    expect(r.type).toBe('shell');
    expect(r.source).toBe('known-command');
  });

  it('flags an NL starter as high-confidence ai', () => {
    expect(classifyInput('how do I deploy').source).toBe('nl-starter');
    expect(classifyInput('explain this code').type).toBe('ai');
  });

  it('flags a pronoun as high-confidence ai', () => {
    const r = classifyInput('I need help with auth');
    expect(r.type).toBe('ai');
    expect(r.source).toBe('nl-pronoun');
  });

  it('uses NL word scoring for longer conversational input', () => {
    // Starts with a non-starter, has no pronoun/?, but most tokens are in the
    // NL/sentence word sets, so it clears the scoring threshold.
    const r = classifyInput('this looks pretty good and that was really nice');
    expect(r.type).toBe('ai');
    expect(r.confidence).toBe(CONFIDENCE.MED);
    expect(r.source).toBe('nl-word-score');
  });

  it('classifies a bare unknown token as low-confidence shell', () => {
    const r = classifyInput('mytool');
    expect(r.type).toBe('shell');
    expect(r.confidence).toBe(CONFIDENCE.LOW);
    expect(r.source).toBe('short-token');
  });

  it('handles an incomplete last token (mid-word) as ai', () => {
    // 'that was really goo' (typing "good"): with the partial last token the
    // NL score is 3/4=0.75 < 0.8 (would NOT pass), but dropping the incomplete
    // token gives 3/3=1.0 >= 1.0, so AI wins. Proves the drop-last branch.
    const r = classifyInput('that was really goo');
    expect(r.type).toBe('ai');
    expect(r.source).toBe('nl-word-score');
  });

  it('sticks to the current mode on ambiguous input', () => {
    const ambiguous = 'foo bar baz qux';
    expect(classifyInput(ambiguous, { currentMode: 'ai' }).type).toBe('ai');
    expect(classifyInput(ambiguous, { currentMode: 'shell' }).type).toBe('shell');
    expect(classifyInput(ambiguous, { currentMode: 'ai' }).source).toBe('sticky-fallback');
  });

  it('returns the empty source for blank input', () => {
    expect(classifyInput('').source).toBe('empty');
    expect(classifyInput('').type).toBe('ai');
  });

  it('exposes tunable constants', () => {
    expect(CONFIDENCE.HIGH).toBeGreaterThan(FLIP_THRESHOLD);
    expect(CONFIDENCE.MED).toBeGreaterThanOrEqual(FLIP_THRESHOLD);
    expect(CONFIDENCE.LOW).toBeLessThan(FLIP_THRESHOLD);
  });
});
```

- [ ] **Step 2: Run the test file, confirm the new block FAILS**

Run: `npx vitest run --config tests/vitest.config.ts tests/unit/commandDetector.test.ts`
Expected: the `classifyInput` tests fail (`classifyInput`/`CONFIDENCE`/`FLIP_THRESHOLD` not exported); the existing `looksLikeShellCommand` tests still pass.

- [ ] **Step 3: Rewrite `src/utils/commandDetector.ts`**

Replace the ENTIRE file with the following. The keyword/word data sets are preserved verbatim from the current file; the function logic is the new pipeline. The `shell-quote` import is removed (no longer used).

```ts
const KNOWN_COMMANDS = new Set([
  'cd', 'ls', 'll', 'la', 'pwd', 'echo', 'cat', 'head', 'tail', 'less', 'more',
  'cp', 'mv', 'rm', 'mkdir', 'rmdir', 'touch', 'chmod', 'chown', 'chgrp', 'ln',
  'find', 'grep', 'rg', 'ag', 'sed', 'awk', 'sort', 'uniq', 'wc', 'tr', 'cut',
  'diff', 'patch', 'file', 'which', 'whereis', 'type', 'alias', 'unalias',
  'export', 'unset', 'source', 'eval', 'exec', 'exit', 'clear', 'reset',
  'history', 'true', 'false', 'test', 'read', 'printf', 'set',
  'du', 'df', 'mount', 'umount', 'tar', 'zip', 'unzip', 'gzip', 'gunzip', 'bzip2',
  'xz', 'zcat', 'stat', 'dd', 'rsync', 'scp',
  'ps', 'top', 'htop', 'btop', 'kill', 'killall', 'pkill', 'fg', 'bg', 'jobs',
  'nohup', 'xargs', 'time', 'watch', 'uptime', 'free', 'uname', 'hostname',
  'whoami', 'id', 'su', 'sudo', 'doas', 'env', 'man', 'info', 'tee',
  'curl', 'wget', 'ssh', 'ping', 'nc', 'netstat', 'ss', 'ip', 'ifconfig',
  'dig', 'nslookup', 'traceroute', 'host',
  'git', 'gh', 'npm', 'npx', 'yarn', 'pnpm', 'bun', 'deno', 'node', 'tsx', 'ts-node',
  'python', 'python3', 'pip', 'pip3', 'pipenv', 'poetry', 'uv', 'uvx',
  'ruby', 'gem', 'bundle', 'rake', 'rails',
  'go', 'cargo', 'rustc', 'rustup',
  'java', 'javac', 'mvn', 'gradle',
  'make', 'cmake', 'gcc', 'g++', 'clang',
  'docker', 'podman', 'kubectl', 'helm',
  'terraform', 'ansible', 'vagrant',
  'vim', 'nvim', 'vi', 'nano', 'emacs', 'code', 'micro',
  'apt', 'apt-get', 'dnf', 'yum', 'pacman', 'brew', 'flatpak', 'snap',
  'jq', 'yq', 'tree', 'bat', 'eza', 'exa', 'fd', 'fzf', 'tmux', 'screen',
  'systemctl', 'journalctl', 'lsof', 'strace',
]);

// CLI agents that TAI wraps as AI providers. When typed as the first token
// these are real shell commands (launching the CLI), but their natural-language
// arguments ("claude how do I fix this") would otherwise classify as AI and
// misroute the launch into the provider instead of running the binary. Always
// treat them as shell. Mirrors Warp's input_classifier guardrail.
const WRAPPED_AGENT_CLIS = new Set(['claude', 'codex', 'gemini']);

const NL_STARTERS = /^(what|why|how|when|where|who|which|can|could|would|should|is|are|do|does|did|will|shall|tell|explain|help|show|describe|fix|find|list|create|make|write|give|suggest|compare|check|analyze|summarize|refactor|debug|implement|add|remove|update|change|convert|translate|generate|optimize|review|please|hey|hi|sorry|thanks|thank)\b/i;

const NL_WORDS = new Set([
  'there', 'here', 'ok', 'okay', 'hold', 'wait', 'but', 'so',
  'actually', 'maybe', 'also', 'just', 'well', 'yeah', 'yes', 'no',
  'nah', 'nope', 'hmm', 'hm', 'ah', 'oh', 'ooh', 'um', 'uh',
  'never', 'always', 'only', 'not', 'dont', 'like', 'let', 'lets',
  'i', 'im', 'its', 'thats', 'whats', 'heres', 'theres',
  'in', 'on', 'at', 'to', 'the', 'a', 'an', 'it', 'we',
  'yep', 'looks', 'good', 'great', 'nice', 'cool', 'sure', 'perfect',
  'sounds', 'awesome', 'fine', 'right', 'correct', 'exactly',
  'that', 'this', 'these', 'those', 'some', 'any', 'every',
  'pretty', 'really', 'very', 'quite', 'super', 'totally',
  'id', 'ill', 'ive', 'youre', 'youll', 'youd', 'youve',
  'wed', 'weve', 'were', 'theyre', 'theyd', 'theyve', 'theyll',
  'hes', 'shes', 'hed', 'shed', 'itll', 'wont', 'cant', 'didnt',
  'doesnt', 'isnt', 'arent', 'wasnt', 'werent', 'hasnt', 'havent',
  'wouldnt', 'couldnt', 'shouldnt', 'mustnt',
]);

const PRONOUNS = new Set([
  'i', 'me', 'my', 'you', 'your', 'we', 'our', 'they', 'their',
  'he', 'she', 'him', 'her', 'us', 'them',
]);

const SENTENCE_WORDS = new Set([
  'the', 'a', 'an', 'this', 'that', 'these', 'those', 'some', 'any', 'every',
  'of', 'for', 'with', 'about', 'into', 'from', 'between', 'through', 'during',
  'before', 'after', 'above', 'below', 'under', 'over',
  'and', 'or', 'but', 'because', 'since', 'although', 'whether', 'wether', 'while',
  'if', 'then', 'than', 'either', 'neither',
  'have', 'has', 'had', 'was', 'were', 'been', 'being', 'am', 'are', 'is',
  'do', 'does', 'did', 'done', 'doing',
  'get', 'got', 'getting', 'gets',
  'know', 'known', 'knew', 'think', 'thought', 'want', 'need', 'see', 'saw', 'seen',
  'going', 'gonna', 'wanna', 'gotta',
  'not', 'very', 'really', 'already', 'still', 'even', 'probably', 'definitely',
]);

export type InputType = 'shell' | 'ai';

export interface ClassifyContext {
  /** Current input mode, used for asymmetric stickiness. */
  currentMode?: InputType;
}

export type DecisionSource =
  | 'empty' | 'agent-cli' | 'shell-syntax' | 'known-command'
  | 'nl-starter' | 'nl-pronoun' | 'question-mark'
  | 'nl-word-score' | 'shell-token-score' | 'short-token' | 'sticky-fallback';

export interface ClassificationResult {
  type: InputType;
  /** 0..1 — synthesized rule-strength, not a true probability. */
  confidence: number;
  source: DecisionSource;
}

export const CONFIDENCE = { HIGH: 0.95, MED: 0.75, LOW: 0.55 } as const;

/** Minimum confidence required for a consumer to auto-flip the input mode. */
export const FLIP_THRESHOLD = 0.7;

const END_TOKEN_COMPLETE = new Set([' ', '?', '!', '.', '"', ',']);

function tokenHasShellSyntax(token: string): boolean {
  return /[|><;&$*?{}()[\]]/.test(token) || /^-{1,2}[a-zA-Z]/.test(token);
}

function nlScore(tokens: string[]): number {
  if (tokens.length === 0) return 0;
  const hits = tokens.filter(t => {
    const w = t.toLowerCase();
    return NL_WORDS.has(w) || SENTENCE_WORDS.has(w);
  }).length;
  return hits / tokens.length;
}

function shellScore(tokens: string[]): number {
  if (tokens.length === 0) return 0;
  const hits = tokens.filter((t, i) => {
    if (i === 0 && KNOWN_COMMANDS.has(t.toLowerCase())) return true;
    return tokenHasShellSyntax(t);
  }).length;
  return hits / tokens.length;
}

function nlThreshold(n: number): number {
  if (n <= 3) return 1.0;
  if (n <= 4) return 0.8;
  return 0.6;
}

function shellThreshold(n: number): number {
  if (n <= 2) return 1.0;
  if (n <= 4) return 0.7;
  return 0.5;
}

export function classifyInput(input: string, ctx?: ClassifyContext): ClassificationResult {
  const trimmed = input.trim();
  if (!trimmed) return { type: 'ai', confidence: 0, source: 'empty' };

  const tokens = trimmed.split(/\s+/);
  const firstWord = tokens[0].toLowerCase();
  const H = CONFIDENCE.HIGH;
  const M = CONFIDENCE.MED;
  const L = CONFIDENCE.LOW;

  // Wrapped agent CLI launch — always shell, ahead of every NL signal.
  if (WRAPPED_AGENT_CLIS.has(firstWord)) return { type: 'shell', confidence: H, source: 'agent-cli' };

  // Explicit shell syntax.
  if (/^[.~/]/.test(trimmed)) return { type: 'shell', confidence: H, source: 'shell-syntax' };
  if (/^[A-Z_][A-Z0-9_]*=/.test(trimmed)) return { type: 'shell', confidence: H, source: 'shell-syntax' };
  if (/[|><;&]/.test(trimmed)) return { type: 'shell', confidence: H, source: 'shell-syntax' };
  if (/\s-{1,2}[a-zA-Z]/.test(trimmed)) return { type: 'shell', confidence: H, source: 'shell-syntax' };

  // Question mark is a strong natural-language signal.
  if (trimmed.includes('?')) return { type: 'ai', confidence: H, source: 'question-mark' };

  // Known command as the first token.
  if (KNOWN_COMMANDS.has(firstWord)) return { type: 'shell', confidence: H, source: 'known-command' };

  // Leading natural-language starter ("how", "explain", "please", ...).
  if (NL_STARTERS.test(trimmed)) return { type: 'ai', confidence: H, source: 'nl-starter' };

  // A pronoun anywhere is a strong conversational signal.
  if (tokens.some(w => PRONOUNS.has(w.toLowerCase()))) return { type: 'ai', confidence: H, source: 'nl-pronoun' };

  // Natural-language word scoring, token-count-scaled. Classify with AND
  // without a still-being-typed last token; AI wins (mirrors Warp).
  const lastChar = trimmed[trimmed.length - 1];
  const lastComplete = END_TOKEN_COMPLETE.has(lastChar);
  let nlPass = nlScore(tokens) >= nlThreshold(tokens.length);
  if (!nlPass && !lastComplete && tokens.length > 2) {
    const dropped = tokens.slice(0, -1);
    nlPass = nlScore(dropped) >= nlThreshold(dropped.length);
  }
  if (nlPass) return { type: 'ai', confidence: M, source: 'nl-word-score' };

  if (shellScore(tokens) >= shellThreshold(tokens.length)) {
    return { type: 'shell', confidence: M, source: 'shell-token-score' };
  }

  // A lone unknown token is probably a command.
  if (tokens.length === 1 && /^[a-z0-9_][\w.-]*$/i.test(firstWord)) {
    return { type: 'shell', confidence: L, source: 'short-token' };
  }

  // No decisive signal — stay in the current mode rather than guess.
  return { type: ctx?.currentMode ?? 'shell', confidence: L, source: 'sticky-fallback' };
}

export function looksLikeShellCommand(input: string): boolean {
  if (!input.trim()) return false;
  return classifyInput(input).type === 'shell';
}
```

- [ ] **Step 4: Run the test file, confirm ALL pass**

Run: `npx vitest run --config tests/vitest.config.ts tests/unit/commandDetector.test.ts`
Expected: PASS — both the original `looksLikeShellCommand` block and the new `classifyInput` block.

- [ ] **Step 5: Run the full suite + build**

Run: `npx vitest run --config tests/vitest.config.ts && npm run build`
Expected: all tests pass; build compiles clean.

- [ ] **Step 6: Commit**

```bash
git add src/utils/commandDetector.ts tests/unit/commandDetector.test.ts
git commit -m "feat(classifier): probabilistic classifyInput with confidence and source

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Confidence-gated mode flip in `TerminalInput`

**Files:**
- Modify: `src/components/TerminalInput.tsx` (import + `handleChange`, ~lines 3 and 240-256)

- [ ] **Step 1: Update the import**

`TerminalInput.tsx:3` currently imports only the boolean helper:

```ts
import { looksLikeShellCommand } from '@/utils/commandDetector';
```

Change it to:

```ts
import { classifyInput, FLIP_THRESHOLD } from '@/utils/commandDetector';
```

(`looksLikeShellCommand` is no longer used in this file after Step 2.)

- [ ] **Step 2: Replace the flip logic in `handleChange`**

The current block at `TerminalInput.tsx:246-255` is:

```ts
    if (!manualOverrideRef.current) {
      const trimmed = newVal.trim();
      if (trimmed.length === 0) {
        if (mode !== 'shell') onModeChange('shell');
      } else if (mode === 'shell' && !looksLikeShellCommand(trimmed)) {
        onModeChange('ai');
      } else if (mode === 'ai' && looksLikeShellCommand(trimmed)) {
        onModeChange('shell');
      }
    }
```

Replace it with:

```ts
    if (!manualOverrideRef.current) {
      const trimmed = newVal.trim();
      if (trimmed.length === 0) {
        if (mode !== 'shell') onModeChange('shell');
      } else {
        const { type, confidence } = classifyInput(trimmed, { currentMode: mode });
        if (confidence >= FLIP_THRESHOLD && type !== mode) {
          onModeChange(type);
        }
      }
    }
```

This preserves the empty-input reset and the `manualOverrideRef` gate, and only flips on MED/HIGH confidence — ambiguous (LOW) input now stays in the current mode.

- [ ] **Step 3: Build + full suite**

Run: `npm run build && npx vitest run --config tests/vitest.config.ts`
Expected: compiles clean (confirms `looksLikeShellCommand` is no longer referenced in `TerminalInput.tsx` and the new imports resolve); all tests pass.

- [ ] **Step 4: Manual verification**

Run `npm run dev`. In a tab:
1. Start typing `git st` — mode should switch to/stay shell.
2. Clear, type `how do I list files` — mode should switch to ai.
3. Type an ambiguous fragment like `foo ba` (mid-word, no strong signal) — mode should NOT bounce back and forth on each keystroke (the LOW-confidence thrash fix).
4. Manually toggle the mode (the existing shortcut) and confirm autodetect stays disabled until you submit/clear (`manualOverrideRef` unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/components/TerminalInput.tsx
git commit -m "feat(input): gate live mode autodetect on classifier confidence

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Final verification

- [ ] Full suite green: `npx vitest run --config tests/vitest.config.ts`
- [ ] Build clean: `npm run build`
- [ ] Manual checks from Task 2 Step 4 confirmed (especially the no-thrash behavior on ambiguous input).
