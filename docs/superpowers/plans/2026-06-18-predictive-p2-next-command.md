# Predictive Commands P2 — Zero-State Next-Command — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a block finishes, suggest a likely next command on the empty composer — instant local heuristic, with an optional debounced AI refine.

**Architecture:** A pure `nextCommand` module merges curated chain rules with the Command Index's `topNext` co-occurrence (from P1), suppressing predictions after a failed command (those route to the existing ErrorAffordance). The composer renders the prediction as dismissible ghost text when empty. An optional AI-refine layer (off by default) can replace the heuristic guess.

**Tech Stack:** TypeScript, React, Vitest. Depends on **P1** (`commandIndex.ts`: `CommandIndex`, `topNext`).

## Global Constraints

- `npm test` only; keep suite green + `npx tsc --noEmit` clean. `@/` = `src/`.
- All prediction logic is **pure**; AI refine is **debounced, cancellable, off by default**, and never blocks input.
- Named consts for any thresholds. Commit after every task.
- **Prerequisite:** P1 merged (provides `topNext`, `CommandIndex`, block ingestion populating `next`).

## File Structure

- `src/utils/nextCommand.ts` — pure: chain rules + co-occurrence merge + failure suppression. New.
- `src/utils/aiNextCommand.ts` — optional AI-refine helper (pure prompt builder + a thin invoker seam). New.
- `src/components/TerminalInput.tsx` — render/accept zero-state suggestion. Modify.
- `src/components/TerminalSession.tsx` — pass `lastCommand`/`lastExitCode`/`cwd` + AI-refine flag. Modify.
- `src/components/SettingsOverlay.tsx` — add the "AI next-command refine" toggle. Modify.

---

### Task 1: nextCommand heuristic (chain rules + co-occurrence + failure suppression)

**Files:**
- Create: `src/utils/nextCommand.ts`
- Test: `tests/unit/nextCommand.test.ts`

**Interfaces:**
- Consumes: `CommandIndex`, `topNext` (P1).
- Produces: `predictNextCommand(ctx: { lastCommand: string; lastExitCode?: number; index: CommandIndex }): string | null`.
  - Returns `null` when `lastExitCode` is non-zero (failure → ErrorAffordance owns it) or no signal.
  - Chain rules win over co-occurrence when both apply.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/nextCommand.test.ts
import { describe, it, expect } from 'vitest';
import { predictNextCommand } from '@/utils/nextCommand';
import { createIndex, ingestBlock } from '@/utils/commandIndex';

describe('predictNextCommand', () => {
  it('suggests git commit after a successful git add', () => {
    expect(predictNextCommand({ lastCommand: 'git add .', lastExitCode: 0, index: createIndex() }))
      .toBe('git commit');
  });

  it('suggests git status after cd into a directory', () => {
    expect(predictNextCommand({ lastCommand: 'cd my-repo', lastExitCode: 0, index: createIndex() }))
      .toBe('git status');
  });

  it('returns null after a failed command (ErrorAffordance owns it)', () => {
    expect(predictNextCommand({ lastCommand: 'git add .', lastExitCode: 1, index: createIndex() }))
      .toBeNull();
  });

  it('falls back to co-occurrence when no chain rule matches', () => {
    const index = createIndex();
    ingestBlock(index, { command: 'pytest', ts: 1, prevCommand: 'ruff check' });
    ingestBlock(index, { command: 'pytest', ts: 2, prevCommand: 'ruff check' });
    expect(predictNextCommand({ lastCommand: 'ruff check', lastExitCode: 0, index }))
      .toBe('pytest');
  });

  it('chain rule beats co-occurrence', () => {
    const index = createIndex();
    ingestBlock(index, { command: 'git log', ts: 1, prevCommand: 'git add .' });
    expect(predictNextCommand({ lastCommand: 'git add .', lastExitCode: 0, index }))
      .toBe('git commit');
  });

  it('returns null for an unknown command with no history', () => {
    expect(predictNextCommand({ lastCommand: 'frobnicate', lastExitCode: 0, index: createIndex() }))
      .toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- nextCommand`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/utils/nextCommand.ts
import { CommandIndex, topNext } from '@/utils/commandIndex';

// Curated chain rules: a matcher on the just-run command → the likely next.
// Ordered; first match wins. Keep this small and high-confidence.
const CHAIN_RULES: { test: (cmd: string) => boolean; next: string }[] = [
  { test: (c) => /^git\s+add\b/.test(c), next: 'git commit' },
  { test: (c) => /^git\s+commit\b/.test(c), next: 'git push' },
  { test: (c) => /^git\s+clone\b/.test(c), next: 'cd ' },
  { test: (c) => /^cd\s+\S/.test(c), next: 'git status' },
  { test: (c) => /^mkdir\s+(\S+)/.test(c), next: 'cd ' },
  { test: (c) => /^npm\s+(i|install)\b/.test(c), next: 'npm run dev' },
  { test: (c) => /^docker\s+build\b/.test(c), next: 'docker run' },
];

export interface NextCommandCtx {
  lastCommand: string;
  lastExitCode?: number;
  index: CommandIndex;
}

export function predictNextCommand(ctx: NextCommandCtx): string | null {
  const cmd = ctx.lastCommand?.trim();
  if (!cmd) return null;
  if (ctx.lastExitCode !== undefined && ctx.lastExitCode !== 0) return null; // failure → ErrorAffordance

  for (const rule of CHAIN_RULES) {
    if (rule.test(cmd)) return rule.next;
  }
  const co = topNext(ctx.index, cmd, 1);
  return co.length > 0 ? co[0] : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- nextCommand`
Expected: PASS (6 tests).

- [ ] **Step 5: Verify suite + types**

Run: `npm test && npx tsc --noEmit`
Expected: PASS, clean.

- [ ] **Step 6: Commit**

```bash
git add src/utils/nextCommand.ts tests/unit/nextCommand.test.ts
git commit -m "feat(predict): next-command heuristic (chain rules + co-occurrence)"
```

---

### Task 2: Render the zero-state suggestion in the composer

**Files:**
- Modify: `src/components/TerminalInput.tsx`, `src/components/TerminalSession.tsx`
- Test: `tests/unit/zeroState.test.tsx`

**Interfaces:**
- Consumes: `predictNextCommand` (Task 1), `commandIndex` prop (P1), new props `lastCommand?: string`, `lastExitCode?: number`.
- Produces: when the composer is **empty** and in shell mode and `lastCommand` is set, the predicted next command renders as ghost text; Tab/→ accepts it (fills the input, does not run); typing or Escape dismisses.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/zeroState.test.tsx
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createIndex } from '@/utils/commandIndex';
import { zeroStateSuggestion } from '@/components/TerminalInput';

// zeroStateSuggestion is the pure helper the component uses to decide what to
// show on an empty composer.
describe('zeroStateSuggestion', () => {
  it('returns the next-command for an empty shell composer after success', () => {
    expect(zeroStateSuggestion('', 'shell', { lastCommand: 'git add .', lastExitCode: 0, index: createIndex() }))
      .toBe('git commit');
  });
  it('returns null when the composer is non-empty', () => {
    expect(zeroStateSuggestion('g', 'shell', { lastCommand: 'git add .', lastExitCode: 0, index: createIndex() }))
      .toBeNull();
  });
  it('returns null in ai mode', () => {
    expect(zeroStateSuggestion('', 'ai', { lastCommand: 'git add .', lastExitCode: 0, index: createIndex() }))
      .toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- zeroState`
Expected: FAIL — `zeroStateSuggestion` not exported.

- [ ] **Step 3: Implement helper + render**

In `TerminalInput.tsx`:
- Export the pure helper:

```ts
import { predictNextCommand, NextCommandCtx } from '@/utils/nextCommand';

export function zeroStateSuggestion(value: string, mode: string, ctx: NextCommandCtx): string | null {
  if (value.length > 0 || mode !== 'shell' || !ctx.lastCommand) return null;
  return predictNextCommand(ctx);
}
```

- Add props `lastCommand?: string` and `lastExitCode?: number`. Compute the zero-state prediction in a memo and feed it into the SAME `prediction` rendering path used for ghost text, so an empty composer shows the next-command as ghost text. Acceptance: the existing Tab (line ~160) and ArrowRight (line ~242) handlers already fill `prediction` into the input — confirm they also fire when `value === ''` (the Tab branch is gated on `mode === 'shell'`, fine; ensure the empty-value case still sets the value). Dismiss on Escape (already clears input).

In `TerminalSession.tsx`: track the last finalized block's command + exitCode (reuse `lastFinalizedCommandRef` from P1; add `lastExitCodeRef`) and pass `lastCommand`/`lastExitCode` to `<TerminalInput/>`. Clear them once the user starts a new command.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- zeroState`
Expected: PASS.

- [ ] **Step 5: Verify suite + types**

Run: `npm test && npx tsc --noEmit`
Expected: PASS, clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/TerminalInput.tsx src/components/TerminalSession.tsx tests/unit/zeroState.test.tsx
git commit -m "feat(predict): zero-state next-command suggestion in composer"
```

---

### Task 3: Optional AI refine (off by default)

**Files:**
- Create: `src/utils/aiNextCommand.ts`
- Test: `tests/unit/aiNextCommand.test.ts`
- Modify: `src/components/TerminalInput.tsx` (consume refine when enabled), `src/components/SettingsOverlay.tsx` (toggle)

**Interfaces:**
- Produces: `buildNextCommandPrompt(ctx: { lastCommand: string; recentCommands: string[]; cwd?: string }): string` (pure); `extractCommand(aiText: string): string | null` (pull a single command from a fenced block or first line).
- The refine invoker is a thin debounced/cancellable wrapper around the existing AI provider IPC; gated on a settings flag `aiNextCommandRefine` (default `false`).

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/aiNextCommand.test.ts
import { describe, it, expect } from 'vitest';
import { buildNextCommandPrompt, extractCommand } from '@/utils/aiNextCommand';

describe('aiNextCommand', () => {
  it('builds a prompt mentioning the last command and cwd', () => {
    const p = buildNextCommandPrompt({ lastCommand: 'git add .', recentCommands: ['ls', 'git add .'], cwd: '/proj' });
    expect(p).toContain('git add .');
    expect(p).toContain('/proj');
  });
  it('extracts a command from a fenced block', () => {
    expect(extractCommand('Sure:\n```bash\ngit commit -m "x"\n```')).toBe('git commit -m "x"');
  });
  it('extracts the first plausible line when no fence', () => {
    expect(extractCommand('git push')).toBe('git push');
  });
  it('returns null for empty/garbage', () => {
    expect(extractCommand('')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- aiNextCommand`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/utils/aiNextCommand.ts
export function buildNextCommandPrompt(ctx: { lastCommand: string; recentCommands: string[]; cwd?: string }): string {
  const recent = ctx.recentCommands.slice(-10).join('\n');
  return [
    'You are a shell next-command predictor. Given the last command and recent history,',
    'reply with ONLY the single most likely next shell command, in a ```bash code block.',
    ctx.cwd ? `Current directory: ${ctx.cwd}` : '',
    `Last command: ${ctx.lastCommand}`,
    `Recent commands:\n${recent}`,
  ].filter(Boolean).join('\n');
}

const FENCE_RE = /```(?:bash|sh|shell)?\n([\s\S]*?)```/;

export function extractCommand(aiText: string): string | null {
  if (!aiText || !aiText.trim()) return null;
  const fenced = aiText.match(FENCE_RE);
  const candidate = (fenced ? fenced[1] : aiText).trim().split('\n')[0]?.trim();
  return candidate && !candidate.startsWith('#') ? candidate : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- aiNextCommand`
Expected: PASS (4 tests).

- [ ] **Step 5: Wire the flag + debounced refine**

In `SettingsOverlay.tsx`, add a `aiNextCommandRefine` boolean toggle (default `false`) persisted with the other settings, labeled "AI next-command suggestions". In `TerminalInput.tsx`, when the flag is on and a zero-state heuristic suggestion is showing, kick a **debounced (400ms), cancellable** AI request via the existing provider IPC using `buildNextCommandPrompt`; on response run `extractCommand` and, if non-null and the composer is still empty, replace the ghost suggestion. Cancel on any keystroke or when the composer becomes non-empty. If the flag is off, never call AI (default path is heuristic-only).

- [ ] **Step 6: Verify suite + types**

Run: `npm test && npx tsc --noEmit`
Expected: PASS, clean.

- [ ] **Step 7: Commit**

```bash
git add src/utils/aiNextCommand.ts tests/unit/aiNextCommand.test.ts src/components/TerminalInput.tsx src/components/SettingsOverlay.tsx
git commit -m "feat(predict): optional debounced AI next-command refine (off by default)"
```

---

**▶ P2 checkpoint:** `npm test && npx tsc --noEmit`, then in-app: run `git add .` (success) → empty composer shows `git commit` ghost text, Tab fills it; run a failing command → no zero-state suggestion (ErrorAffordance handles it). Toggle the AI flag on → suggestion refines after ~400ms without blocking typing.

## Self-Review

- **Spec coverage:** heuristic chain rules + co-occurrence + failure suppression → Task 1; zero-state render/accept → Task 2; optional debounced/cancellable AI refine off-by-default → Task 3.
- **Placeholder scan:** all code present; the AI-refine wiring reuses the existing provider IPC (described concretely) rather than inventing an API.
- **Type consistency:** `predictNextCommand`/`NextCommandCtx`, `zeroStateSuggestion`, `buildNextCommandPrompt`/`extractCommand`, flag `aiNextCommandRefine` used consistently. Depends on P1's `topNext`/`CommandIndex`.
