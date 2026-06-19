# Predictive Commands P4 — Workflows + Command Palette — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add local parameterized workflows (saved snippets with `{{param}}`) and a Cmd-K command palette that fuzzy-searches history, workflows, and known commands.

**Architecture:** Pure helpers parse/substitute workflow params and rank palette items; a userData JSON store (same pattern as the command index) holds workflows locally; a Cmd-K modal (reusing existing modal infra + key-routing) surfaces a merged, ranked result list and runs/inserts the chosen item, prompting for params via a small dialog.

**Tech Stack:** TypeScript, React, Electron, Vitest. Reuses **P1** (`commandIndex` for history-as-palette-source) and the existing modal/key-routing utilities.

## Global Constraints

- `npm test` only; keep suite green + `npx tsc --noEmit` clean. `@/` = `src/`.
- Workflows are **local-only** (no cloud), persisted as capped JSON in userData (same pattern as `electron/services/commandIndexStore.ts`).
- Cmd-K must respect existing **key routing** (`src/utils/keyRouting.ts` `classifyKeyTarget`) — it opens only when the page (not an xterm/REPL/input) owns the key, or via an explicit global accelerator that doesn't break REPL input.
- Pure helpers for param parsing/substitution and palette ranking → unit-testable. Commit after every task.

## File Structure

- `src/utils/workflows.ts` — pure: `parseParams`, `substituteParams`, workflow types. New.
- `electron/services/workflowStore.ts` — userData JSON CRUD (debounced) + IPC. New.
- `src/utils/palette.ts` — pure: merge + fuzzy-rank palette items. New.
- `src/components/CommandPalette.tsx` (+ `.module.css`) — Cmd-K modal. New.
- `src/components/WorkflowRunDialog.tsx` (+ `.module.css`) — param prompt. New.
- `src/components/TerminalSession.tsx` / app root — Cmd-K binding + wiring. Modify.

---

### Task 1: Workflow param parsing + substitution

**Files:**
- Create: `src/utils/workflows.ts`
- Test: `tests/unit/workflows.test.ts`

**Interfaces:**
- Produces:
  - `interface Workflow { id: string; name: string; command: string; description?: string }`
  - `parseParams(command: string): string[]` — ordered, de-duplicated `{{param}}` names.
  - `substituteParams(command: string, values: Record<string, string>): string` — replaces `{{name}}`; missing values left as the literal placeholder.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/workflows.test.ts
import { describe, it, expect } from 'vitest';
import { parseParams, substituteParams } from '@/utils/workflows';

describe('workflow params', () => {
  it('extracts ordered unique params', () => {
    expect(parseParams('deploy {{env}} --tag {{tag}} to {{env}}')).toEqual(['env', 'tag']);
  });
  it('returns empty for a param-less command', () => {
    expect(parseParams('git status')).toEqual([]);
  });
  it('substitutes provided values', () => {
    expect(substituteParams('deploy {{env}}', { env: 'prod' })).toBe('deploy prod');
  });
  it('leaves missing params as the literal placeholder', () => {
    expect(substituteParams('deploy {{env}} {{tag}}', { env: 'prod' })).toBe('deploy prod {{tag}}');
  });
  it('replaces every occurrence of a repeated param', () => {
    expect(substituteParams('{{x}} and {{x}}', { x: '1' })).toBe('1 and 1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- workflows`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/utils/workflows.ts
export interface Workflow {
  id: string;
  name: string;
  command: string;
  description?: string;
}

const PARAM_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

export function parseParams(command: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  let m: RegExpExecArray | null;
  PARAM_RE.lastIndex = 0;
  while ((m = PARAM_RE.exec(command)) !== null) {
    const name = m[1];
    if (!seen.has(name)) { seen.add(name); out.push(name); }
  }
  return out;
}

export function substituteParams(command: string, values: Record<string, string>): string {
  return command.replace(PARAM_RE, (whole, name) =>
    Object.prototype.hasOwnProperty.call(values, name) ? values[name] : whole);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- workflows`
Expected: PASS (5 tests).

- [ ] **Step 5: Verify suite + types**

Run: `npm test && npx tsc --noEmit`
Expected: PASS, clean.

- [ ] **Step 6: Commit**

```bash
git add src/utils/workflows.ts tests/unit/workflows.test.ts
git commit -m "feat(workflows): param parsing + substitution"
```

---

### Task 2: Workflow store (userData JSON, debounced) + IPC

**Files:**
- Create: `electron/services/workflowStore.ts`
- Test: `tests/unit/workflowStore.test.ts`
- Modify: `electron/main.ts`, `electron/preload.ts`, `src/types/window.d.ts`

**Interfaces:**
- Consumes: `Workflow` (Task 1).
- Produces (pure, testable): `serializeWorkflows(list): string`, `deserializeWorkflows(raw: string | null): Workflow[]` (defensive: bad/oversized → `[]`, cap `MAX_WORKFLOWS = 500`). Plus runtime `loadWorkflows()`, `saveWorkflows(list)`, IPC `workflows:get`/`workflows:set`.
- Renderer IPC: `window.tai.workflows.get(): Promise<Workflow[]>`, `.set(list: Workflow[]): void`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/workflowStore.test.ts
import { describe, it, expect } from 'vitest';
import { serializeWorkflows, deserializeWorkflows, MAX_WORKFLOWS } from '../../electron/services/workflowStore';

describe('workflowStore (de)serialize', () => {
  it('round-trips workflows', () => {
    const list = [{ id: '1', name: 'Deploy', command: 'deploy {{env}}' }];
    expect(deserializeWorkflows(serializeWorkflows(list))).toEqual(list);
  });
  it('returns [] for null/garbage', () => {
    expect(deserializeWorkflows(null)).toEqual([]);
    expect(deserializeWorkflows('{not json')).toEqual([]);
    expect(deserializeWorkflows('{"x":1}')).toEqual([]);
  });
  it('drops malformed entries and caps the list', () => {
    const big = Array.from({ length: MAX_WORKFLOWS + 10 }, (_, i) => ({ id: `${i}`, name: `w${i}`, command: 'x' }));
    expect(deserializeWorkflows(JSON.stringify(big)).length).toBe(MAX_WORKFLOWS);
    expect(deserializeWorkflows(JSON.stringify([{ id: 1 }, { id: 'ok', name: 'n', command: 'c' }])))
      .toEqual([{ id: 'ok', name: 'n', command: 'c' }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- workflowStore`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// electron/services/workflowStore.ts
import { app, ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { Workflow } from '../../src/utils/workflows';

export const MAX_WORKFLOWS = 500;
const file = () => path.join(app.getPath('userData'), 'workflows.json');

export function serializeWorkflows(list: Workflow[]): string {
  return JSON.stringify(list);
}

function isWorkflow(w: any): w is Workflow {
  return w && typeof w.id === 'string' && typeof w.name === 'string' && typeof w.command === 'string';
}

export function deserializeWorkflows(raw: string | null): Workflow[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isWorkflow).slice(0, MAX_WORKFLOWS);
  } catch {
    return [];
  }
}

export function loadWorkflows(): Workflow[] {
  let raw: string | null = null;
  try { raw = fs.readFileSync(file(), 'utf-8'); } catch { raw = null; }
  return deserializeWorkflows(raw);
}

export function saveWorkflows(list: Workflow[]): void {
  try { fs.writeFileSync(file(), serializeWorkflows(list.slice(0, MAX_WORKFLOWS)), { mode: 0o600 }); } catch { /* best effort */ }
}

export function registerWorkflowIpc(): void {
  ipcMain.handle('workflows:get', () => loadWorkflows());
  ipcMain.on('workflows:set', (_e, list: Workflow[]) => saveWorkflows(list));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- workflowStore`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire IPC + preload + types**

`electron/main.ts`: call `registerWorkflowIpc()` once after ready. `electron/preload.ts`: add `workflows: { get: () => ipcRenderer.invoke('workflows:get'), set: (l) => ipcRenderer.send('workflows:set', l) }`. `src/types/window.d.ts`: matching type using `import('@/utils/workflows').Workflow`.

- [ ] **Step 6: Verify suite + types + build**

Run: `npm test && npx tsc --noEmit && npm run build`
Expected: PASS; build succeeds (store imports the pure `src/utils/workflows`).

- [ ] **Step 7: Commit**

```bash
git add electron/services/workflowStore.ts tests/unit/workflowStore.test.ts electron/main.ts electron/preload.ts src/types/window.d.ts
git commit -m "feat(workflows): local userData workflow store with IPC"
```

---

### Task 3: Palette ranking (merge history + workflows + commands)

**Files:**
- Create: `src/utils/palette.ts`
- Test: `tests/unit/palette.test.ts`

**Interfaces:**
- Consumes: `Workflow` (Task 1); palette draws history from the P1 `CommandIndex` (caller passes command strings) and known commands from P3 specs (caller passes names) — `palette.ts` itself only ranks a merged item list.
- Produces:
  - `type PaletteSource = 'history' | 'workflow' | 'command'`
  - `interface PaletteItem { id: string; label: string; value: string; source: PaletteSource; description?: string }`
  - `rankPaletteItems(query: string, items: PaletteItem[]): PaletteItem[]` — subsequence fuzzy match; empty query returns items unchanged (caller pre-orders by recency).

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/palette.test.ts
import { describe, it, expect } from 'vitest';
import { rankPaletteItems, PaletteItem } from '@/utils/palette';

const items: PaletteItem[] = [
  { id: '1', label: 'git checkout', value: 'git checkout', source: 'history' },
  { id: '2', label: 'Deploy prod', value: 'deploy {{env}}', source: 'workflow' },
  { id: '3', label: 'grep', value: 'grep', source: 'command' },
];

describe('rankPaletteItems', () => {
  it('returns all items unchanged for an empty query', () => {
    expect(rankPaletteItems('', items)).toEqual(items);
  });
  it('fuzzy-matches a subsequence', () => {
    const r = rankPaletteItems('gco', items).map(i => i.value);
    expect(r).toContain('git checkout'); // g..c..o subsequence
    expect(r).not.toContain('deploy {{env}}');
  });
  it('ranks a tighter match higher', () => {
    const r = rankPaletteItems('gre', items);
    expect(r[0].value).toBe('grep');
  });
  it('matches workflow labels too', () => {
    expect(rankPaletteItems('deploy', items).map(i => i.value)).toContain('deploy {{env}}');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- palette`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/utils/palette.ts
export type PaletteSource = 'history' | 'workflow' | 'command';
export interface PaletteItem {
  id: string; label: string; value: string; source: PaletteSource; description?: string;
}

// Subsequence fuzzy score: lower is better (gaps penalized); null = no match.
function fuzzyScore(query: string, text: string): number | null {
  const q = query.toLowerCase(), t = text.toLowerCase();
  let qi = 0, score = 0, lastIdx = -1;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      if (lastIdx >= 0) score += ti - lastIdx - 1; // gap penalty
      lastIdx = ti; qi++;
    }
  }
  return qi === q.length ? score + t.length * 0.001 : null;
}

export function rankPaletteItems(query: string, items: PaletteItem[]): PaletteItem[] {
  if (!query.trim()) return items;
  const scored: { item: PaletteItem; score: number }[] = [];
  for (const item of items) {
    const s = fuzzyScore(query, item.label);
    if (s !== null) scored.push({ item, score: s });
  }
  scored.sort((a, b) => a.score - b.score);
  return scored.map((s) => s.item);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- palette`
Expected: PASS (4 tests).

- [ ] **Step 5: Verify suite + types**

Run: `npm test && npx tsc --noEmit`
Expected: PASS, clean.

- [ ] **Step 6: Commit**

```bash
git add src/utils/palette.ts tests/unit/palette.test.ts
git commit -m "feat(palette): merged fuzzy ranking for history/workflow/command items"
```

---

### Task 4: Command palette modal + param dialog + Cmd-K wiring

**Files:**
- Create: `src/components/CommandPalette.tsx` (+ `.module.css`), `src/components/WorkflowRunDialog.tsx` (+ `.module.css`)
- Modify: `src/components/TerminalSession.tsx` (or app root), `src/components/SettingsOverlay.tsx` (workflow CRUD entry — minimal: list + add/delete)
- Test: `tests/unit/CommandPalette.test.tsx`

**Interfaces:**
- Consumes: `rankPaletteItems`/`PaletteItem` (Task 3), `Workflow`/`parseParams`/`substituteParams` (Task 1), `window.tai.workflows` (Task 2), the P1 `commandIndex` (history source), `getSpec`/registry command names (P3), `classifyKeyTarget` (`src/utils/keyRouting.ts`).
- Produces: a `CommandPalette` opened with Cmd/Ctrl-K; arrow-select; Enter inserts the value into the composer (or, if the value has `{{params}}`, opens `WorkflowRunDialog` to collect them first); Cmd/Ctrl-Enter runs immediately. Escape closes.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/CommandPalette.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CommandPalette } from '@/components/CommandPalette';
import { PaletteItem } from '@/utils/palette';

const items: PaletteItem[] = [
  { id: '1', label: 'git status', value: 'git status', source: 'history' },
  { id: '2', label: 'Deploy', value: 'deploy {{env}}', source: 'workflow' },
];

describe('CommandPalette', () => {
  it('filters items by typed query and selects on Enter', () => {
    const onPick = vi.fn();
    render(<CommandPalette open items={items} onPick={onPick} onClose={() => {}} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'git' } });
    expect(screen.getByText('git status')).toBeTruthy();
    expect(screen.queryByText('Deploy')).toBeNull();
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ value: 'git status' }), false);
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(<CommandPalette open items={items} onPick={() => {}} onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- CommandPalette`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement CommandPalette (and WorkflowRunDialog)**

`CommandPalette.tsx` (props `{ open: boolean; items: PaletteItem[]; onPick: (item: PaletteItem, runNow: boolean) => void; onClose: () => void }`): a modal (mirror `ConfirmModal.tsx` structure/portal) with a text input (`role="textbox"`), a list rendered from `rankPaletteItems(query, items)`, arrow-key selection (index state), Enter → `onPick(selected, false)`, Cmd/Ctrl-Enter → `onPick(selected, true)`, Escape → `onClose()`. Render `source` as a small tag and `description` when present.

`WorkflowRunDialog.tsx` (props `{ workflow: Workflow; onRun: (command: string, runNow: boolean) => void; onCancel: () => void }`): one input per `parseParams(workflow.command)` (Tab cycles fields), preview of `substituteParams(...)`, Run/Insert buttons.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- CommandPalette`
Expected: PASS (2 tests).

- [ ] **Step 5: Wire Cmd-K + sources into TerminalSession**

In `TerminalSession.tsx` (or the app root that owns global keys):
- Build the palette item list on open: history from `commandIndex` (top-N commands by frecency → `source: 'history'`), workflows from `window.tai.workflows.get()` (`source: 'workflow'`, label = name, value = command), and known command names from the P3 registry (`source: 'command'`).
- Add a key handler for Cmd/Ctrl-K that opens the palette ONLY when `classifyKeyTarget(document.activeElement) !== 'xterm'` (don't steal the key from a live REPL); register it at the page level consistent with existing key routing.
- `onPick(item, runNow)`: if `parseParams(item.value).length > 0` open `WorkflowRunDialog`; else insert `item.value` into the composer (and run if `runNow`).
- Minimal workflow CRUD in `SettingsOverlay.tsx`: list saved workflows with name+command, an add form, and delete; persist via `window.tai.workflows.set(list)`.

- [ ] **Step 6: Verify suite + types + build**

Run: `npm test && npx tsc --noEmit && npm run build`
Expected: PASS; build clean.

- [ ] **Step 7: Commit**

```bash
git add src/components/CommandPalette.tsx src/components/CommandPalette.module.css src/components/WorkflowRunDialog.tsx src/components/WorkflowRunDialog.module.css src/components/TerminalSession.tsx src/components/SettingsOverlay.tsx tests/unit/CommandPalette.test.tsx
git commit -m "feat(palette): Cmd-K command palette + workflow run dialog"
```

---

**▶ P4 checkpoint:** `npm test && npx tsc --noEmit && npm run build`, then in-app: Cmd-K opens the palette; typing fuzzy-filters across history/workflows/commands; Enter inserts, Cmd-Enter runs; a saved `deploy {{env}}` workflow opens the param dialog, Tab cycles fields, Run executes the substituted command; Cmd-K does NOT fire while a REPL/agent owns the terminal.

## Self-Review

- **Spec coverage:** parameterized snippets (`{{param}}` parse/substitute) → Task 1; local userData store → Task 2; merged fuzzy palette ranking → Task 3; Cmd-K modal + param dialog + key-routing-aware wiring + minimal CRUD → Task 4.
- **Placeholder scan:** all code present; Task 4's source-assembly and CRUD are described concretely against named APIs (no TODOs).
- **Type consistency:** `Workflow`/`parseParams`/`substituteParams`, `PaletteItem`/`PaletteSource`/`rankPaletteItems`, store `serialize/deserializeWorkflows`/`MAX_WORKFLOWS`, IPC `workflows:get/set`, component prop shapes (`CommandPalette`, `WorkflowRunDialog`) consistent across tasks. Reuses P1 `commandIndex`, P3 registry, existing `classifyKeyTarget`.
