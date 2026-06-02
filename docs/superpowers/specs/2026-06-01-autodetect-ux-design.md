# P2 — Autodetect UX (Design)

**Date:** 2026-06-01
**Status:** Design — awaiting review
**Parent:** [Warp AI & Detection Deep Dive](./2026-06-01-warp-ai-detection-deep-dive.md) (recommendation P2)
**Builds on:** P1's `classifyInput` (`src/utils/commandDetector.ts`).

## Goal

Make TAI's existing live mode autodetection visible and add Warp's `!` shell escape, so the user can see *when the mode was auto-chosen* and can force a one-off shell command from AI mode — without disturbing the existing `Shift+Tab` toggle / `Escape`-to-clear behavior.

## Current state

`src/components/TerminalInput.tsx` already:
- Renders the mode (`✦` glyph for AI, `user/path$` for shell) and a bottom-right hint `Shift+Tab → AI/Shell` (lines ~357-360).
- Auto-flips the mode on each keystroke via P1's `classifyInput` (confidence-gated).
- Supports a sticky manual override: `Shift+Tab` flips + sets `manualOverrideRef = true` (disables autodetect); `Escape` clears it (lines 112-116, 194-197); submit/clear also clears it (~line 230).

Two gaps vs Warp: (1) no signal that the *current* mode was auto-detected (the change is silent), and (2) no `!` prefix to force shell from AI mode.

## Architecture

### Pure UX helpers (`src/utils/inputModeUx.ts`, new)

Two small, unit-tested pure functions keep the decision logic out of the JSX:

```ts
import type { InputType } from '@/utils/commandDetector';

/** In AI mode, a leading '!' forces a one-off shell command (Warp-style). */
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

### `TerminalInput.tsx` changes

1. **Make override status reactive.** Replace `manualOverrideRef` (a `ref`, invisible to render) with `const [manualOverride, setManualOverride] = useState(false)`. Update the existing 5 sites (set `true` on `Shift+Tab`; set `false` on `Escape`, on submit/clear reset, and — new — when the input becomes empty). The `handleChange`/`handleKeyDown` handlers are recreated each render, so they read the current state value.

2. **`!` force-shell in `handleChange`.** At the top of `handleChange`, run `stripForceShellPrefix(mode, e.target.value)`. If `forceShell`, set the value to the stripped text, `setManualOverride(true)`, `onModeChange('shell')`, reset the tab/prediction scratch state, and return (skip autodetect for this change). Because the stripped value no longer starts with `!`, it won't re-fire. Only fires in AI mode, so shell history-expansion `!` is untouched.

3. **Reset override on empty.** In the existing empty-input branch of `handleChange`, also `setManualOverride(false)` so autodetect resumes for the next input. (Minor, intentional change to the prior behavior where emptying the field kept a manual override; this is Warp-consistent — the sticky choice applies to the current input.)

4. **Render the "auto" chip.** In the hint cluster (lines ~357-360), before the `Shift+Tab` kbd, render when `shouldShowAutoBadge(value, manualOverride)`:

```tsx
{showAutoBadge && (
  <span className={styles.autoBadge} title="Mode auto-detected — Shift+Tab to lock, ! to force shell">
    auto
  </span>
)}
```

5. **CSS.** Add an `.autoBadge` class to TerminalInput's CSS module (the file imported as `styles`): a small, muted, magenta-tinted chip (Warp shows "(autodetected)" in magenta), matching the existing `.kbd`/`.hint` sizing. Exact selector and adjacent classes confirmed at plan time by reading the module.

## Data flow

```
keystroke → handleChange
   → stripForceShellPrefix(mode, raw)   // ! → force shell + lock
   → (else) classifyInput(...)          // P1, confidence-gated autodetect
render:
   shouldShowAutoBadge(value, manualOverride) → show/hide "auto" chip
```

## Out of scope

- Surfacing P1's `source`/confidence in the badge (kept binary auto/locked — YAGNI).
- A `!` escape inside a *running* CLI agent's REPL (that is P3 — this `!` is only the AI-input composer).
- Changing the `Shift+Tab` / `Escape` mechanics themselves.

## Testing (TDD)

`tests/unit/inputModeUx.test.ts`:
- `stripForceShellPrefix('ai', '!ls -la')` → `{ value: 'ls -la', forceShell: true }`.
- `stripForceShellPrefix('ai', 'hello')` → `{ value: 'hello', forceShell: false }`.
- `stripForceShellPrefix('shell', '!foo')` → `{ value: '!foo', forceShell: false }` (shell `!` untouched).
- `stripForceShellPrefix('ai', '!')` → `{ value: '', forceShell: true }`.
- `shouldShowAutoBadge('git status', false)` → `true`; `('git status', true)` → `false`; `('', false)` → `false`; `('   ', false)` → `false`.

The `TerminalInput` wiring (state conversion, badge render, CSS) is verified by `npm run build` (compiles, no stale `manualOverrideRef`) and the manual checks below — it's React/CSS glue; its logic lives in the unit-tested helpers and P1's `classifyInput`.

## Manual verification

1. Type `how do I deploy` from shell → mode flips to AI and the **auto** chip appears.
2. `Shift+Tab` → mode locks (AI↔shell), **auto** chip disappears (manual).
3. `Escape` (or clear the line) → override clears, autodetect resumes, chip returns on next input.
4. In AI mode, type `!ls -la` → the `!` is stripped, mode flips to shell, input shows `ls -la`, chip hidden (locked); Enter runs it as a shell command.
5. In shell mode, type `!foo` → unchanged (no interception; shell history expansion intact).

## Risks & mitigations

- **State conversion regressions** — `manualOverrideRef` → state touches 5 sites; the build catches stale `.current` refs, and manual checks 2-3 confirm toggle/clear still work.
- **`!` collision** — only intercepted in AI mode, so shell `!` (history expansion) is never touched.
- **Empty-reset behavior change** — emptying the field now resumes autodetect even after a manual toggle; intentional and Warp-consistent, called out above.
