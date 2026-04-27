# Tab AI-Working Indicator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-tab pulsing dot to the tab strip that surfaces "AI is currently working" status persistently, including across tab switches.

**Architecture:** A new `aiWorking?: boolean` flag on `TabState` is the single source of truth. Each `TerminalSession` derives its own AI-working state from its `displayItems` (an `'ai'` item with `streaming: true` exists) and reports changes upward via an `onAiWorkingChange` callback. `App` updates `TabState`. `TabBar` renders a pulsing dot when the flag is `true`.

**Tech Stack:** TypeScript, React (renderer process of the Electron app), CSS modules, Vitest (Node env, no jsdom — only the pure helper is unit-tested).

---

## File Structure

**New:**
- `src/utils/hasActiveAi.ts` — pure helper that returns `true` iff any item is an active AI block.
- `tests/unit/hasActiveAi.test.ts` — unit test for the helper.

**Modified:**
- `src/types.ts` — add `aiWorking?: boolean` to `TabState`.
- `src/components/TerminalSession.tsx` — add `onAiWorkingChange?: (working: boolean) => void` prop; report changes via a `useEffect`.
- `src/App.tsx` — pass an `onAiWorkingChange` handler that updates `TabState`.
- `src/components/TabBar.tsx` — render a dot in `TabItem` when `tab.aiWorking` is `true`.
- `src/components/TabBar.module.css` — `.workingDot` and `@keyframes tabDotPulse`.

---

## Task 1: Extend `TabState` with `aiWorking`

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Add the field**

In `src/types.ts`, edit the `TabState` interface to add a new optional field after `aiProvider`:

```ts
export interface TabState {
  id: string;
  ptyId: number | null;
  label: string;
  cwd: string;
  contextMode: ContextMode;
  trustLevel: TrustLevel;
  isRemote: boolean;
  sshTarget: string | null;
  remoteExecMode: 'auto' | 'local';
  aiProvider: AIProvider;
  aiWorking?: boolean;
}
```

- [ ] **Step 2: Verify type-check passes**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat(types): add aiWorking flag to TabState"
```

---

## Task 2: Add `hasActiveAi` pure helper (TDD)

This helper inspects the `displayItems` array used inside `TerminalSession` and returns `true` if there is any `'ai'` block currently streaming. Extracting it to a utility makes it unit-testable in the existing Node-env Vitest setup.

**Files:**
- Create: `src/utils/hasActiveAi.ts`
- Test: `tests/unit/hasActiveAi.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/hasActiveAi.test.ts` with:

```ts
import { describe, it, expect } from 'vitest';
import { hasActiveAi } from '@/utils/hasActiveAi';

describe('hasActiveAi', () => {
  it('returns false for an empty list', () => {
    expect(hasActiveAi([])).toBe(false);
  });

  it('returns true when an ai item is streaming', () => {
    const items: any[] = [
      { type: 'ai', id: 'a', question: '', entries: [], content: '', streaming: true },
    ];
    expect(hasActiveAi(items)).toBe(true);
  });

  it('returns false when ai items exist but none are streaming', () => {
    const items: any[] = [
      { type: 'ai', id: 'a', question: '', entries: [], content: '', streaming: false },
      { type: 'ai', id: 'b', question: '', entries: [], content: '', streaming: false },
    ];
    expect(hasActiveAi(items)).toBe(false);
  });

  it('ignores non-ai items', () => {
    const items: any[] = [
      { type: 'command', block: { id: 'x' }, collapsed: false, active: true, aiSuggested: false },
      { type: 'approval', id: 'y', command: '', status: 'pending' },
    ];
    expect(hasActiveAi(items)).toBe(false);
  });

  it('returns true if any ai item among many is streaming', () => {
    const items: any[] = [
      { type: 'ai', id: 'a', question: '', entries: [], content: '', streaming: false },
      { type: 'ai', id: 'b', question: '', entries: [], content: '', streaming: true },
    ];
    expect(hasActiveAi(items)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test -- hasActiveAi`
Expected: FAIL with a module-not-found error for `@/utils/hasActiveAi`.

- [ ] **Step 3: Implement the helper**

Create `src/utils/hasActiveAi.ts`:

```ts
import type { DisplayItem } from '@/types';

export function hasActiveAi(items: DisplayItem[]): boolean {
  return items.some(item => item.type === 'ai' && item.streaming);
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npm test -- hasActiveAi`
Expected: 5 passing tests.

- [ ] **Step 5: Commit**

```bash
git add src/utils/hasActiveAi.ts tests/unit/hasActiveAi.test.ts
git commit -m "feat(utils): add hasActiveAi helper"
```

---

## Task 3: Report AI-working changes from `TerminalSession`

`TerminalSession` already maintains `displayItems`, where each AI block has a `streaming` boolean that flips to `false` on `done`, `error`, `approval_needed`, user `Stop`, and when a new request supersedes the old one. We add an `onAiWorkingChange` prop and fire it whenever the derived value changes.

**Files:**
- Modify: `src/components/TerminalSession.tsx`

- [ ] **Step 1: Add the prop to the component's props interface**

In `src/components/TerminalSession.tsx`, locate the `TerminalSessionProps` interface (the props type used by `TerminalSession`) and add the optional callback. The interface already contains `onContextModeChange`, `onRemoteChange`, `onTrustLevelChange`, etc.; add this one alongside them:

```ts
onAiWorkingChange?: (working: boolean) => void;
```

- [ ] **Step 2: Destructure the prop**

In the `TerminalSession` function signature (around line 44), add `onAiWorkingChange` to the destructured props list.

- [ ] **Step 3: Add the import for the helper**

Add to the imports at the top of the file:

```ts
import { hasActiveAi } from '@/utils/hasActiveAi';
```

- [ ] **Step 4: Add the effect that reports changes**

Place this `useEffect` near the other top-level effects in the component (e.g. just after the existing effect that watches `displayItems.some(item => item.type === 'command' && item.active)` around line 193). The dependency is `displayItems`:

```ts
const aiWorking = hasActiveAi(displayItems);
useEffect(() => {
  onAiWorkingChange?.(aiWorking);
}, [aiWorking, onAiWorkingChange]);
```

(Computing `aiWorking` outside the effect keeps the dep list a primitive boolean, so the effect only fires when the value actually flips.)

- [ ] **Step 5: Verify type-check passes**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/TerminalSession.tsx
git commit -m "feat(terminal): emit onAiWorkingChange when AI streaming state flips"
```

---

## Task 4: Wire the callback in `App` to update `TabState`

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add the handler**

In `src/App.tsx`, alongside the other per-tab handlers (`handleContextModeChange`, `handleRemoteChange`, etc., around lines 103–118), add:

```ts
const handleAiWorkingChange = useCallback((tabId: string, working: boolean) => {
  setTabs(prev => prev.map(t =>
    t.id === tabId
      ? (t.aiWorking === working ? t : { ...t, aiWorking: working })
      : t
  ));
}, []);
```

The early-return-if-equal guard avoids a no-op re-render when the effect fires with the same value.

- [ ] **Step 2: Pass the prop to `TerminalSession`**

In the `tabs.map(tab => …)` JSX (around line 182), add the prop to the `<TerminalSession ... />`:

```tsx
onAiWorkingChange={(working) => handleAiWorkingChange(tab.id, working)}
```

Place it near the other `on*Change` props.

- [ ] **Step 3: Verify type-check passes**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "feat(app): track per-tab aiWorking state from TerminalSession"
```

---

## Task 5: Render the dot in `TabBar`

**Files:**
- Modify: `src/components/TabBar.tsx`
- Modify: `src/components/TabBar.module.css`

- [ ] **Step 1: Add the CSS for the dot and its animation**

Append to `src/components/TabBar.module.css`:

```css
/* ── AI working indicator ────────────────────────────────── */
.workingDot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--color-agent);
  box-shadow: 0 0 6px var(--color-agent);
  animation: tabDotPulse 1.4s ease-in-out infinite;
  flex-shrink: 0;
}

@keyframes tabDotPulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.4; transform: scale(0.8); }
}
```

- [ ] **Step 2: Render the dot in `TabItem`**

In `src/components/TabBar.tsx`, inside `TabItem`, add the dot immediately after the `tabIndex` span (currently at line 59) and before the `editingId === tab.id ? …` ternary (line 60):

```tsx
{tab.aiWorking && <span className={styles.workingDot} aria-label="AI working" />}
```

The `tabIndex` already sits at the start of the tab; the dot appears between it and the label. The conditional render means no slot is reserved when idle (acceptable layout nudge per the spec).

- [ ] **Step 3: Verify type-check passes**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual smoke test**

Run the dev build:

```bash
npm run dev
```

In the running app:
1. Send an AI message in the active tab. Verify the pulsing green dot appears next to the tab label while the AI is generating, and disappears when the response completes.
2. While the AI is still generating, switch to another tab. Verify the dot stays visible on the original tab.
3. Click **Stop** on the AI block. Verify the dot disappears.
4. Trigger a tool-approval prompt (a tool call that requires confirmation under the current `trustLevel`). Verify the dot disappears while waiting for approval (this matches the spec's "just working vs idle" behavior — `streaming` is set `false` on `approval_needed`).
5. Open multiple tabs and start AI requests in two of them. Verify both tabs show the dot independently.

- [ ] **Step 5: Commit**

```bash
git add src/components/TabBar.tsx src/components/TabBar.module.css
git commit -m "feat(tabs): render pulsing AI-working dot on tab"
```

---

## Self-Review Notes

- **Spec coverage:** All five sections of the spec map to a task — type extension (T1), state derivation (T2+T3), App wiring (T4), tab visual + animation (T5).
- **No placeholders:** every step is concrete code or an exact command.
- **Type consistency:** the prop is `onAiWorkingChange: (working: boolean) => void` everywhere; the field is `aiWorking?: boolean` everywhere.
- **Layout-nudge open question:** acknowledged in the spec; the plan picks "render only when active" and surfaces the manual smoke step where it would be visible.
- **Approval state:** the spec is "just working vs idle"; the existing code already sets `streaming: false` on `approval_needed`, so deriving from `streaming` matches the spec without extra work. Smoke step 4 verifies this.
