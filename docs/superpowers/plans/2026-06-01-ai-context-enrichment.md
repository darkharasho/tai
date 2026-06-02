# AI Context Enrichment (P0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the AI agent Warp-style ambient awareness of recent terminal activity (commands, exit codes, cwd, git branch) across all providers by pushing a compact context section into the existing per-turn `<system>` block, and enrich the claude on-demand history tool.

**Architecture:** A pure `buildRecentContext()` helper renders a delta of recent command blocks; it is wired into the provider-agnostic `<system>` preamble at `TerminalSession.tsx` (so claude/codex/gemini all receive it — push parity is free). git branch comes from a new cached `git:branch` IPC. The pull side (`TerminalHistory` MCP tool, claude-only) gets richer entries via a shared, unit-tested `formatHistoryEntries` function embedded into the generated server script.

**Tech Stack:** TypeScript, React (renderer), Electron main process IPC, Vitest. Spec: `docs/superpowers/specs/2026-06-01-ai-context-enrichment-design.md`.

---

## File Structure

- **Create** `src/utils/aiContext.ts` — pure `buildRecentContext()` (push renderer). One responsibility: format recent blocks into a context string.
- **Create** `tests/unit/aiContext.test.ts` — unit tests for the above.
- **Create** `electron/services/git.ts` — `setupGitService()` + pure `resolveGitBranch()`; cached `git:branch` IPC.
- **Create** `tests/unit/gitBranch.test.ts` — unit tests for `resolveGitBranch`.
- **Create** `electron/services/historyFormat.ts` — pure `formatHistoryEntries()` + `HistoryEntry` type (shared by the MCP script).
- **Create** `tests/unit/historyFormat.test.ts` — unit tests for the above.
- **Modify** `electron/services/mcpHistoryServer.ts` — embed `formatHistoryEntries` source instead of the inline `formatHistory`.
- **Modify** `electron/main.ts` — register `setupGitService`.
- **Modify** `electron/preload.ts` — expose `git.branch`; widen `ai.updateHistory` entry type.
- **Modify** `electron/services/claude.ts:384` — widen `ai:updateHistory` handler entry type.
- **Modify** `src/types/window.d.ts` — type `git.branch`; widen `updateHistory` entries.
- **Modify** `src/components/TerminalSession.tsx` — git-branch ref; wire `buildRecentContext` into the `<system>` block; enrich `updateHistory` entries.

---

## Task 1: `buildRecentContext` push helper

**Files:**
- Create: `src/utils/aiContext.ts`
- Test: `tests/unit/aiContext.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/aiContext.test.ts
import { describe, it, expect } from 'vitest';
import { buildRecentContext } from '@/utils/aiContext';
import type { DisplayItem } from '@/components/BlockList';

function cmd(id: string, command: string, output = '', exitCode?: number): DisplayItem {
  return {
    type: 'command',
    active: false,
    block: {
      id, command, output, exitCode,
      rawOutput: output, promptText: '$', startTime: 0, duration: 0,
      isRemote: false, hooksAvailable: false,
    } as any,
  };
}

describe('buildRecentContext', () => {
  it('returns empty text and the latest id when there are no new commands', () => {
    const items = [cmd('b1', 'ls'), cmd('b2', 'pwd')];
    const r = buildRecentContext(items, 'b2');
    expect(r.text).toBe('');
    expect(r.lastId).toBe('b2');
  });

  it('selects only command blocks after sinceId', () => {
    const items = [cmd('b1', 'ls'), cmd('b2', 'pwd'), cmd('b3', 'whoami')];
    const r = buildRecentContext(items, 'b1');
    expect(r.text).toContain('$ pwd');
    expect(r.text).toContain('$ whoami');
    expect(r.text).not.toContain('$ ls');
    expect(r.lastId).toBe('b3');
  });

  it('includes all completed commands when sinceId is null', () => {
    const items = [cmd('b1', 'ls'), cmd('b2', 'pwd')];
    const r = buildRecentContext(items, null);
    expect(r.text).toContain('$ ls');
    expect(r.text).toContain('$ pwd');
  });

  it('annotates [exit N] only for non-zero exits', () => {
    const items = [cmd('b1', 'true', '', 0), cmd('b2', 'false', '', 1)];
    const r = buildRecentContext(items, null);
    expect(r.text).toContain('$ true');
    expect(r.text).not.toContain('$ true  [exit');
    expect(r.text).toContain('$ false  [exit 1]');
  });

  it('includes output only for the most recent command and any failed command', () => {
    const items = [
      cmd('b1', 'cmd-old', 'old-output', 0),
      cmd('b2', 'cmd-fail', 'fail-output', 1),
      cmd('b3', 'cmd-last', 'last-output', 0),
    ];
    const r = buildRecentContext(items, null);
    expect(r.text).not.toContain('old-output');
    expect(r.text).toContain('fail-output');
    expect(r.text).toContain('last-output');
  });

  it('truncates output to maxOutputChars', () => {
    const big = 'x'.repeat(5000);
    const items = [cmd('b1', 'big', big, 0)];
    const r = buildRecentContext(items, null, undefined, { maxOutputChars: 100 });
    expect(r.text).toContain('chars truncated');
    expect(r.text.length).toBeLessThan(1600);
  });

  it('caps the number of commands to maxCommands (keeping the most recent)', () => {
    const items = Array.from({ length: 10 }, (_, i) => cmd(`b${i}`, `cmd${i}`));
    const r = buildRecentContext(items, null, undefined, { maxCommands: 3 });
    expect(r.text).toContain('$ cmd9');
    expect(r.text).toContain('$ cmd7');
    expect(r.text).not.toContain('$ cmd6');
  });

  it('emits a cwd/git status line when provided', () => {
    const items = [cmd('b1', 'ls')];
    const withBranch = buildRecentContext(items, null, { cwd: '/p', gitBranch: 'main' });
    expect(withBranch.text).toContain('cwd: /p (git: main)');
    const noBranch = buildRecentContext(items, null, { cwd: '/p', gitBranch: null });
    expect(noBranch.text).toContain('cwd: /p');
    expect(noBranch.text).not.toContain('(git:');
  });

  it('enforces budgetChars by dropping oldest output then oldest commands', () => {
    const items = Array.from({ length: 5 }, (_, i) =>
      cmd(`b${i}`, `cmd${i}`, 'y'.repeat(400), i === 1 ? 1 : 0));
    const r = buildRecentContext(items, null, undefined, { budgetChars: 300, maxOutputChars: 400 });
    expect(r.text.length).toBeLessThanOrEqual(300);
    expect(r.text).toContain('$ cmd4'); // most recent command always survives
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run --config tests/vitest.config.ts tests/unit/aiContext.test.ts`
Expected: FAIL — `buildRecentContext` is not exported / module missing.

- [ ] **Step 3: Write the implementation**

```ts
// src/utils/aiContext.ts
import type { DisplayItem } from '@/components/BlockList';

export interface RecentContextOptions {
  maxCommands?: number;
  maxOutputChars?: number;
  budgetChars?: number;
}

export interface RecentContextResult {
  text: string;
  lastId: string | null;
}

const DEFAULTS = { maxCommands: 5, maxOutputChars: 800, budgetChars: 1500 };

type CommandItem = DisplayItem & { type: 'command' };

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + `\n… (${s.length - max} chars truncated)`;
}

function isFailed(c: CommandItem): boolean {
  return c.block.exitCode !== undefined && c.block.exitCode !== 0;
}

export function buildRecentContext(
  items: DisplayItem[],
  sinceId: string | null,
  status?: { cwd?: string; gitBranch?: string | null },
  opts: RecentContextOptions = {},
): RecentContextResult {
  const maxCommands = opts.maxCommands ?? DEFAULTS.maxCommands;
  const maxOutputChars = opts.maxOutputChars ?? DEFAULTS.maxOutputChars;
  const budgetChars = opts.budgetChars ?? DEFAULTS.budgetChars;

  const commands = items.filter(
    (it): it is CommandItem => it.type === 'command' && !it.active,
  );

  let startIdx = 0;
  if (sinceId) {
    const idx = commands.findIndex(c => c.block.id === sinceId);
    startIdx = idx === -1 ? 0 : idx + 1;
  }
  const fresh = commands.slice(startIdx);
  const lastId = commands.length ? commands[commands.length - 1].block.id : sinceId;

  if (fresh.length === 0) return { text: '', lastId };

  const selected = fresh.slice(-maxCommands);
  const entries = selected.map((c, i) => ({
    cmd: c,
    withOutput: i === selected.length - 1 || isFailed(c),
  }));

  const renderLine = (c: CommandItem, withOutput: boolean): string => {
    const exit = c.block.exitCode;
    const exitStr = exit !== undefined && exit !== 0 ? `  [exit ${exit}]` : '';
    let line = `$ ${c.block.command}${exitStr}`;
    if (withOutput && c.block.output && c.block.output.trim()) {
      line += '\n' + truncate(c.block.output.trim(), maxOutputChars);
    }
    return line;
  };

  const render = (): string => {
    const head = status?.cwd
      ? `cwd: ${status.cwd}${status.gitBranch ? ` (git: ${status.gitBranch})` : ''}`
      : '';
    const body = entries.map(e => renderLine(e.cmd, e.withOutput));
    return [head, 'recent terminal activity:', ...body].filter(Boolean).join('\n');
  };

  // Budget: strip outputs oldest-first (never the last), then drop oldest commands.
  for (let i = 0; i < entries.length - 1 && render().length > budgetChars; i++) {
    entries[i].withOutput = false;
  }
  while (entries.length > 1 && render().length > budgetChars) {
    entries.shift();
  }

  return { text: render(), lastId };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --config tests/vitest.config.ts tests/unit/aiContext.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/utils/aiContext.ts tests/unit/aiContext.test.ts
git commit -m "feat(ai): add buildRecentContext push helper

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `git:branch` IPC service

**Files:**
- Create: `electron/services/git.ts`
- Test: `tests/unit/gitBranch.test.ts`
- Modify: `electron/main.ts:7-8` (imports), `electron/main.ts:110-111` (setup calls)

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/gitBranch.test.ts
import { describe, it, expect } from 'vitest';
import { resolveGitBranch } from '../../electron/services/git';

describe('resolveGitBranch', () => {
  it('returns the trimmed branch name from exec output', () => {
    const exec = (_cwd: string) => 'main\n';
    expect(resolveGitBranch('/repo', exec)).toBe('main');
  });

  it('returns null when not in a git repo (exec throws)', () => {
    const exec = () => { throw new Error('not a git repository'); };
    expect(resolveGitBranch('/tmp', exec)).toBeNull();
  });

  it('returns null for empty/detached output', () => {
    expect(resolveGitBranch('/repo', () => '')).toBeNull();
    expect(resolveGitBranch('/repo', () => 'HEAD\n')).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run --config tests/vitest.config.ts tests/unit/gitBranch.test.ts`
Expected: FAIL — module/`resolveGitBranch` missing.

- [ ] **Step 3: Write the implementation**

```ts
// electron/services/git.ts
import { ipcMain } from 'electron';
import { execFileSync } from 'node:child_process';

export type BranchExec = (cwd: string) => string;

const defaultExec: BranchExec = (cwd: string) =>
  execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
    cwd,
    encoding: 'utf8',
    timeout: 1000,
    stdio: ['ignore', 'pipe', 'ignore'],
  });

/** Resolve the current git branch for `cwd`, or null if none/detached. */
export function resolveGitBranch(cwd: string, exec: BranchExec = defaultExec): string | null {
  try {
    const out = exec(cwd).trim();
    if (!out || out === 'HEAD') return null;
    return out;
  } catch {
    return null;
  }
}

export function setupGitService(): void {
  // Cache keyed by cwd; cleared opportunistically when it grows large.
  const cache = new Map<string, string | null>();
  ipcMain.handle('git:branch', (_event, cwd: string) => {
    if (!cwd) return null;
    if (cache.has(cwd)) return cache.get(cwd) ?? null;
    if (cache.size > 64) cache.clear();
    const branch = resolveGitBranch(cwd);
    cache.set(cwd, branch);
    return branch;
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --config tests/vitest.config.ts tests/unit/gitBranch.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Register the service in main**

In `electron/main.ts`, add to the imports block (near line 7-8):

```ts
import { setupGitService } from './services/git';
```

And alongside the other `setup*Service` calls (near line 110-111):

```ts
  setupGitService();
```

- [ ] **Step 6: Verify the build compiles**

Run: `npm run build`
Expected: `tsc` + vite build succeed with no type errors.

- [ ] **Step 7: Commit**

```bash
git add electron/services/git.ts tests/unit/gitBranch.test.ts electron/main.ts
git commit -m "feat(git): add cached git:branch IPC service

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Wire push context into the `<system>` block

**Files:**
- Modify: `electron/preload.ts:46-52` (add `git.branch`)
- Modify: `src/types/window.d.ts` (type `git.branch`)
- Modify: `src/components/TerminalSession.tsx` (branch ref + `<system>` wiring + ref reset)

- [ ] **Step 1: Expose `git.branch` in preload**

In `electron/preload.ts`, add a top-level `git` namespace inside the `exposeInMainWorld('tai', { ... })` object (e.g. just after the `ai: { ... }` block):

```ts
  git: {
    branch: (cwd: string): Promise<string | null> => ipcRenderer.invoke('git:branch', cwd),
  },
```

- [ ] **Step 2: Type it in `window.d.ts`**

In `src/types/window.d.ts`, add to the `tai` interface (mirror the existing namespaces):

```ts
    git: {
      branch: (cwd: string) => Promise<string | null>;
    };
```

- [ ] **Step 3: Add a git-branch ref synced on cwd change**

In `src/components/TerminalSession.tsx`, near the other refs (around line 124, by `preambleSentRef`):

```ts
  const lastContextBlockIdRef = useRef<string | null>(null);
  const gitBranchRef = useRef<string | null>(null);
```

Add an effect that refreshes the branch whenever `cwd` changes (place near the other `cwd` effects, ~line 155):

```ts
  useEffect(() => {
    if (!cwd) { gitBranchRef.current = null; return; }
    let cancelled = false;
    window.tai?.git?.branch(cwd).then(b => { if (!cancelled) gitBranchRef.current = b; });
    return () => { cancelled = true; };
  }, [cwd]);
```

Reset the context cursor when the provider/tab changes — extend the existing reset at `TerminalSession.tsx:138`:

```ts
    preambleSentRef.current = false;
    lastContextBlockIdRef.current = null;
```

- [ ] **Step 4: Inject the recent-context section into the `<system>` block**

In `handleAIRequest`, the `<system>` block is built at `TerminalSession.tsx:534-569`. Add the import at the top of the file:

```ts
import { buildRecentContext } from '@/utils/aiContext';
```

Replace the per-turn `Working directory` push (currently `lines.push(\`Working directory: ${cwd}\`);` at ~line 567) with:

```ts
    const recent = buildRecentContext(displayItems, lastContextBlockIdRef.current, {
      cwd,
      gitBranch: gitBranchRef.current,
    });
    if (recent.text) {
      lines.push('', recent.text);
    } else {
      lines.push(`Working directory: ${cwd}`);
    }
    lastContextBlockIdRef.current = recent.lastId;
```

Note: `recent.text` already carries the `cwd (git: branch)` status line, so the explicit `Working directory` line is only the fallback when there is no new activity.

- [ ] **Step 5: Verify the build compiles and existing tests pass**

Run: `npm run build && npx vitest run --config tests/vitest.config.ts`
Expected: build succeeds; all existing tests still pass.

- [ ] **Step 6: Manual verification**

Run the app (`npm run dev`). In a tab: run `ls`, then a failing command (`cat nope`), then ask the AI "what did I just do?". Confirm the agent references the recent commands and the failed exit without calling any tool. Then ask a follow-up immediately — confirm the second prompt does NOT repeat the same command list (delta works).

- [ ] **Step 7: Commit**

```bash
git add electron/preload.ts src/types/window.d.ts src/components/TerminalSession.tsx
git commit -m "feat(ai): push recent terminal context into the system preamble

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Enrich the pull-side history tool

**Files:**
- Create: `electron/services/historyFormat.ts`
- Test: `tests/unit/historyFormat.test.ts`
- Modify: `electron/services/mcpHistoryServer.ts`
- Modify: `electron/preload.ts` (`ai.updateHistory` entry type)
- Modify: `electron/services/claude.ts:384` (handler entry type)
- Modify: `src/types/window.d.ts` (`updateHistory` entry type)
- Modify: `src/components/TerminalSession.tsx:144-152` (entry mapping)

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/historyFormat.test.ts
import { describe, it, expect } from 'vitest';
import { formatHistoryEntries } from '../../electron/services/historyFormat';

describe('formatHistoryEntries', () => {
  it('returns a placeholder for empty input', () => {
    expect(formatHistoryEntries([])).toBe('No terminal history available.');
  });

  it('renders command, non-zero exit, cwd, branch, and duration', () => {
    const text = formatHistoryEntries([
      { command: 'npm test', output: 'fail', exitCode: 1, cwd: '/p', gitBranch: 'main', durationMs: 1200 },
    ]);
    expect(text).toContain('$ npm test');
    expect(text).toContain('[exit 1]');
    expect(text).toContain('/p');
    expect(text).toContain('main');
    expect(text).toContain('1.2s');
    expect(text).toContain('fail');
  });

  it('omits the exit annotation for zero exit and truncates long output', () => {
    const text = formatHistoryEntries([
      { command: 'ls', output: 'x'.repeat(5000), exitCode: 0 },
    ]);
    expect(text).not.toContain('[exit');
    expect(text).toContain('truncated');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run --config tests/vitest.config.ts tests/unit/historyFormat.test.ts`
Expected: FAIL — module/`formatHistoryEntries` missing.

- [ ] **Step 3: Write the implementation (self-contained — no imports, so it can be stringified into the MCP script)**

```ts
// electron/services/historyFormat.ts
export interface HistoryEntry {
  command: string;
  output?: string;
  exitCode?: number;
  cwd?: string;
  gitBranch?: string | null;
  durationMs?: number;
  timestamp?: number;
}

/**
 * Render history entries into the text returned by the TerminalHistory MCP tool.
 * MUST stay self-contained (no imports/closures): its source is embedded via
 * Function.prototype.toString() into the standalone MCP server script.
 */
export function formatHistoryEntries(entries: HistoryEntry[]): string {
  if (!entries || entries.length === 0) return 'No terminal history available.';
  const lines: string[] = [];
  for (const entry of entries) {
    const exitStr = entry.exitCode !== undefined && entry.exitCode !== 0
      ? ' [exit ' + entry.exitCode + ']' : '';
    const meta: string[] = [];
    if (entry.cwd) meta.push(entry.cwd);
    if (entry.gitBranch) meta.push('git:' + entry.gitBranch);
    if (entry.durationMs !== undefined) meta.push((entry.durationMs / 1000).toFixed(1) + 's');
    const metaStr = meta.length ? '  (' + meta.join(', ') + ')' : '';
    lines.push('$ ' + entry.command + exitStr + metaStr);
    if (entry.output && entry.output.trim()) {
      let out = entry.output;
      if (out.length > 2000) {
        out = out.slice(0, 1000) + '\n... (' + (out.length - 2000) + ' chars truncated) ...\n' + out.slice(-1000);
      }
      lines.push(out.trim());
    }
    lines.push('');
  }
  return lines.join('\n');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --config tests/vitest.config.ts tests/unit/historyFormat.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Embed the shared formatter in the generated MCP script**

In `electron/services/mcpHistoryServer.ts`, add at the top:

```ts
import { formatHistoryEntries } from './historyFormat';
```

Remove the inline `formatHistory` function from the generated script string (the `function formatHistory(entries) { ... }` block) and replace it by interpolating the shared function's source, then call it. Concretely, inside the template literal returned by `generateHistoryServerScript`, replace the `formatHistory` definition with:

```ts
${formatHistoryEntries.toString()}
```

and change the call site in the script from `formatHistory(entries)` to `formatHistoryEntries(entries)`. (The `readHistory` function stays as-is.)

- [ ] **Step 6: Widen the entry types end-to-end**

In `electron/preload.ts`, update `ai.updateHistory`:

```ts
    updateHistory: (key: string, entries: Array<{ command: string; output: string; exitCode?: number; cwd?: string; gitBranch?: string | null; durationMs?: number; timestamp?: number }>) =>
      ipcRenderer.send('ai:updateHistory', key, entries),
```

In `electron/services/claude.ts:384`, widen the handler parameter type to match (same shape as above).

In `src/types/window.d.ts`, widen the `updateHistory` entries type to the same shape.

- [ ] **Step 7: Enrich the entries produced in the renderer**

In `src/components/TerminalSession.tsx:144-152`, update the `.map` to include the new fields:

```ts
      .map(item => ({
        command: item.block.command,
        output: item.block.output,
        exitCode: item.block.exitCode,
        cwd: item.block.cwd ?? cwd,
        gitBranch: gitBranchRef.current,
        durationMs: item.block.duration,
        timestamp: item.block.startTime,
      }));
```

Add `cwd` to the effect's dependency array (it already depends on `displayItems`, `tabId`).

- [ ] **Step 8: Verify build and full suite**

Run: `npm run build && npx vitest run --config tests/vitest.config.ts`
Expected: build succeeds; all tests pass.

- [ ] **Step 9: Manual verification (claude pull)**

Run the app with the claude provider. Run a few commands including a failing one, then ask the AI to "use the TerminalHistory tool and tell me my last command's exit code and directory". Confirm the tool output now shows cwd, branch, and duration.

- [ ] **Step 10: Commit**

```bash
git add electron/services/historyFormat.ts tests/unit/historyFormat.test.ts electron/services/mcpHistoryServer.ts electron/preload.ts electron/services/claude.ts src/types/window.d.ts src/components/TerminalSession.tsx
git commit -m "feat(ai): enrich TerminalHistory entries with cwd, branch, duration

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Final verification

- [ ] Run the full test suite: `npx vitest run --config tests/vitest.config.ts` — all green.
- [ ] Build: `npm run build` — no type errors.
- [ ] Manual end-to-end (Task 3 Step 6 + Task 4 Step 9) confirmed.
- [ ] Confirm push parity: repeat Task 3 Step 6 with the **codex** and **gemini** providers selected — the agent should reference recent activity (push reaches all providers). Pull-tool parity for codex/gemini is intentionally out of scope (see spec §Out of scope).
