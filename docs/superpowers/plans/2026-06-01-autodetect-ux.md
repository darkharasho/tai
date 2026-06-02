# Autodetect UX (P2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make TAI's live mode autodetection visible with an "auto" provenance chip and add Warp's `!` force-shell prefix, without disturbing the existing `Shift+Tab` toggle / `Escape`-to-clear.

**Architecture:** Two pure, unit-tested helpers in a new `src/utils/inputModeUx.ts` carry the `!`-strip and badge-visibility logic. `TerminalInput.tsx` converts its `manualOverrideRef` to reactive state (so the chip can render), wires the helpers into `handleChange`, renders the chip in the hint cluster, and resets the override when the input empties. A small `.autoBadge` CSS class is added.

**Tech Stack:** TypeScript, React, CSS modules, Vitest. Spec: `docs/superpowers/specs/2026-06-01-autodetect-ux-design.md`.

---

## File Structure

- **Create** `src/utils/inputModeUx.ts` — `stripForceShellPrefix`, `shouldShowAutoBadge`. Pure UX decision logic.
- **Create** `tests/unit/inputModeUx.test.ts` — unit tests.
- **Modify** `src/components/TerminalInput.tsx` — ref→state conversion, `!` wiring, chip render, empty-reset.
- **Modify** `src/components/TerminalInput.module.css` — `.autoBadge` class.

---

## Task 1: Pure UX helpers

**Files:**
- Create: `src/utils/inputModeUx.ts`
- Test: `tests/unit/inputModeUx.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/inputModeUx.test.ts
import { describe, it, expect } from 'vitest';
import { stripForceShellPrefix, shouldShowAutoBadge } from '@/utils/inputModeUx';

describe('stripForceShellPrefix', () => {
  it('strips a leading ! and forces shell in ai mode', () => {
    expect(stripForceShellPrefix('ai', '!ls -la')).toEqual({ value: 'ls -la', forceShell: true });
  });

  it('handles a lone ! in ai mode', () => {
    expect(stripForceShellPrefix('ai', '!')).toEqual({ value: '', forceShell: true });
  });

  it('leaves non-! ai input untouched', () => {
    expect(stripForceShellPrefix('ai', 'hello')).toEqual({ value: 'hello', forceShell: false });
  });

  it('never intercepts ! in shell mode (history expansion)', () => {
    expect(stripForceShellPrefix('shell', '!foo')).toEqual({ value: '!foo', forceShell: false });
  });

  it('only strips a leading !, not a mid-string one', () => {
    expect(stripForceShellPrefix('ai', 'foo!bar')).toEqual({ value: 'foo!bar', forceShell: false });
  });
});

describe('shouldShowAutoBadge', () => {
  it('shows when autodetect governs non-empty input', () => {
    expect(shouldShowAutoBadge('git status', false)).toBe(true);
  });

  it('hides when manually overridden', () => {
    expect(shouldShowAutoBadge('git status', true)).toBe(false);
  });

  it('hides on empty or whitespace-only input', () => {
    expect(shouldShowAutoBadge('', false)).toBe(false);
    expect(shouldShowAutoBadge('   ', false)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests, confirm they FAIL**

Run: `npx vitest run --config tests/vitest.config.ts tests/unit/inputModeUx.test.ts`
Expected: FAIL — module/exports missing.

- [ ] **Step 3: Implement `src/utils/inputModeUx.ts`**

```ts
import type { InputType } from '@/utils/commandDetector';

/**
 * In AI mode, a leading '!' forces a one-off shell command (Warp-style):
 * the '!' is stripped and the caller switches to shell. In shell mode the
 * input is untouched so the shell's own '!' history expansion is preserved.
 */
export function stripForceShellPrefix(
  mode: InputType,
  value: string,
): { value: string; forceShell: boolean } {
  if (mode === 'ai' && value.startsWith('!')) {
    return { value: value.slice(1), forceShell: true };
  }
  return { value, forceShell: false };
}

/** The "auto" provenance chip shows only while autodetect governs a non-empty input. */
export function shouldShowAutoBadge(value: string, manualOverride: boolean): boolean {
  return value.trim().length > 0 && !manualOverride;
}
```

- [ ] **Step 4: Run tests, confirm PASS**

Run: `npx vitest run --config tests/vitest.config.ts tests/unit/inputModeUx.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/utils/inputModeUx.ts tests/unit/inputModeUx.test.ts
git commit -m "feat(input): add force-shell-prefix and auto-badge UX helpers

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Wire badge + `!` into `TerminalInput`

**Files:**
- Modify: `src/components/TerminalInput.tsx`
- Modify: `src/components/TerminalInput.module.css`

- [ ] **Step 1: Import the helpers**

At the top of `src/components/TerminalInput.tsx`, add (near the existing `@/utils/commandDetector` import):

```ts
import { stripForceShellPrefix, shouldShowAutoBadge } from '@/utils/inputModeUx';
```

- [ ] **Step 2: Convert the override ref to state**

`TerminalInput.tsx:73` is:

```ts
  const manualOverrideRef = useRef(false);
```

Replace it with:

```ts
  const [manualOverride, setManualOverride] = useState(false);
```

(`useState` is already imported in this file.)

- [ ] **Step 3: Update the `Shift+Tab` handler**

In `handleKeyDown`, the `Shift+Tab` branch (`TerminalInput.tsx:112-116`) currently sets `manualOverrideRef.current = true;`. Change that one line to:

```ts
      setManualOverride(true);
```

- [ ] **Step 4: Update the `Escape` handler**

In `handleKeyDown`, the `Escape` branch (~`TerminalInput.tsx:194-198`) currently sets `manualOverrideRef.current = false;`. Change that one line to:

```ts
      setManualOverride(false);
```

- [ ] **Step 5: Update the Enter-submit reset**

In `handleKeyDown`, the `Enter` branch (~`TerminalInput.tsx:226-235`) currently sets `manualOverrideRef.current = false;` after `onSubmit`. Change that one line to:

```ts
      setManualOverride(false);
```

- [ ] **Step 6: Rewrite `handleChange`**

The current `handleChange` (after P1) is:

```ts
  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newVal = e.target.value;
    setValue(newVal);
    setTabCompletions([]);
    setTabIndex(-1);
    tabPrefixRef.current = '';
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
  };
```

Replace it entirely with:

```ts
  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    // In AI mode, a leading '!' forces a one-off shell command: strip it,
    // lock to shell, and skip autodetect for this change.
    const forced = stripForceShellPrefix(mode, e.target.value);
    if (forced.forceShell) {
      setValue(forced.value);
      setTabCompletions([]);
      setTabIndex(-1);
      tabPrefixRef.current = '';
      setManualOverride(true);
      onModeChange('shell');
      return;
    }

    const newVal = forced.value;
    setValue(newVal);
    setTabCompletions([]);
    setTabIndex(-1);
    tabPrefixRef.current = '';

    const trimmed = newVal.trim();
    if (trimmed.length === 0) {
      // Clearing the field resumes autodetect for the next input.
      setManualOverride(false);
      if (mode !== 'shell') onModeChange('shell');
      return;
    }
    if (!manualOverride) {
      const { type, confidence } = classifyInput(trimmed, { currentMode: mode });
      if (confidence >= FLIP_THRESHOLD && type !== mode) {
        onModeChange(type);
      }
    }
  };
```

- [ ] **Step 7: Compute the badge flag**

`TerminalInput.tsx:259` is `const isAI = mode === 'ai';`. Immediately after it, add:

```ts
  const showAutoBadge = shouldShowAutoBadge(value, manualOverride);
```

- [ ] **Step 8: Render the chip in the hint cluster**

The hint cluster (`TerminalInput.tsx:357-360`) is:

```tsx
          <div className={styles.hint}>
            <span className={styles.kbd}>Shift+Tab</span>
            <span className={styles.hintLabel}>{isAI ? 'Shell' : 'AI'}</span>
          </div>
```

Replace it with:

```tsx
          <div className={styles.hint}>
            {showAutoBadge && (
              <span className={styles.autoBadge} title="Mode auto-detected — Shift+Tab to lock, ! to force shell">
                auto
              </span>
            )}
            <span className={styles.kbd}>Shift+Tab</span>
            <span className={styles.hintLabel}>{isAI ? 'Shell' : 'AI'}</span>
          </div>
```

- [ ] **Step 9: Add the `.autoBadge` CSS**

In `src/components/TerminalInput.module.css`, add this class right after the `.hintLabel` block (which ends at line 182):

```css
.autoBadge {
  color: #d782d9;
  font-size: 10px;
  font-weight: 500;
  font-family: var(--font-sans);
  letter-spacing: 0.02em;
  opacity: 0.85;
  text-transform: lowercase;
}
```

- [ ] **Step 10: Verify build + full suite**

Run: `npm run build && npx vitest run --config tests/vitest.config.ts`
Expected: compiles clean (proves no stale `manualOverrideRef` / `useRef` left dangling and the new imports resolve); all tests pass.

- [ ] **Step 11: Grep for stale references**

Run: `grep -n "manualOverrideRef" src/components/TerminalInput.tsx`
Expected: NO matches. (If any remain, convert them to `manualOverride`/`setManualOverride` and re-run Step 10.)

- [ ] **Step 12: Manual verification**

Run `npm run dev`. In a tab:
1. From shell, type `how do I deploy` → mode flips to AI and the **auto** chip appears next to `Shift+Tab`.
2. `Shift+Tab` → mode locks; **auto** chip disappears.
3. `Escape` (clears the line) → override clears; type again → chip returns.
4. In AI mode, type `!ls -la` → `!` is stripped, mode flips to shell, field shows `ls -la`, chip hidden; Enter runs it as shell.
5. In shell mode, type `!foo` → unchanged (no interception).
6. Toggle to AI with `Shift+Tab`, then delete all text → mode returns to shell and autodetect resumes (intentional empty-reset).

- [ ] **Step 13: Commit**

```bash
git add src/components/TerminalInput.tsx src/components/TerminalInput.module.css
git commit -m "feat(input): show auto-detect chip and support ! force-shell prefix

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Final verification

- [ ] Full suite green: `npx vitest run --config tests/vitest.config.ts`
- [ ] Build clean: `npm run build`
- [ ] `grep -n manualOverrideRef src/components/TerminalInput.tsx` → no matches.
- [ ] Manual checks (Task 2 Step 12) confirmed — especially the `!` force-shell and the auto chip showing/hiding with override.
