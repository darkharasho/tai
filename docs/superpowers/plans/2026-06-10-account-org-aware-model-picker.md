# Account/org-aware Claude model picker (tai) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace tai's hardcoded Claude model dropdown with a list derived at runtime from the Claude CLI's `~/.claude.json` cache (org gating, 1M-context access, account-specific extras), keeping a refreshed static list as offline fallback.

**Architecture:** A new side-effect-free module `electron/services/claudeModels.ts` holds the model lineup, the `~/.claude.json` reader, and a pure `deriveClaudeModels(cfg)` function. `claude.ts` registers an `ai:models` IPC handler that calls it. Preload exposes `window.tai.ai.models()`. `App.tsx` prefetches the list, re-validates the persisted choice against it, and passes it to `QuickSettings`, which renders the live list or the static fallback.

**Tech Stack:** Electron (main + preload), React + TypeScript renderer, Vitest (`tests/vitest.config.ts`, forks pool capped at 2 workers), Testing Library for component tests.

**Spec:** `docs/superpowers/specs/2026-06-10-account-org-aware-model-picker-design.md`

**Note on structure:** The spec placed the derivation logic inside `electron/services/claude.ts`. This plan extracts it into a focused `claudeModels.ts` instead — `claude.ts` has a heavy import graph (SSH, MCP, daemon proxies) that makes it brittle to import in a unit test. The new module imports only `fs`/`os`/`path`, so the pure logic is testable with zero mocking.

---

### Task 1: Model lineup + org-aware derivation (`claudeModels.ts`)

**Files:**
- Create: `electron/services/claudeModels.ts`
- Test: `tests/unit/claudeModels.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/claudeModels.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { deriveClaudeModels, BASE_CLAUDE_MODELS } from '../../electron/services/claudeModels';

const ORG = '0bd5376b-34e3-414d-ba59-be2613bfac1a';

describe('deriveClaudeModels', () => {
  it('returns the base list (detected:false) when config is null', () => {
    expect(deriveClaudeModels(null)).toEqual({ models: BASE_CLAUDE_MODELS, detected: false });
  });

  it('returns the base list when there is no oauthAccount', () => {
    expect(deriveClaudeModels({ s1mAccessCache: {} })).toEqual({ models: BASE_CLAUDE_MODELS, detected: false });
  });

  it('omits 1M variants when the org lacks 1M access', () => {
    const { models, detected } = deriveClaudeModels({
      oauthAccount: { organizationUuid: ORG },
      s1mAccessCache: { [ORG]: { hasAccess: false } },
    });
    expect(detected).toBe(true);
    const values = models.map(m => m.value);
    expect(values).not.toContain('opus[1m]');
    expect(values).not.toContain('sonnet[1m]');
    expect(values).toContain('opus');
    expect(values).toContain('sonnet');
  });

  it('includes 1M variants when the org has 1M access', () => {
    const { models } = deriveClaudeModels({
      oauthAccount: { organizationUuid: ORG },
      s1mAccessCache: { [ORG]: { hasAccess: true } },
    });
    const values = models.map(m => m.value);
    expect(values).toContain('opus[1m]');
    expect(values).toContain('sonnet[1m]');
  });

  it('appends account-specific extra models with extra:true', () => {
    const { models } = deriveClaudeModels({
      oauthAccount: { organizationUuid: ORG },
      additionalModelOptionsCache: [{ value: 'claude-fable-5', label: 'Fable 5', description: 'Experimental' }],
    });
    const fable = models.find(m => m.value === 'claude-fable-5');
    expect(fable).toMatchObject({ value: 'claude-fable-5', label: 'Fable 5', description: 'Experimental', extra: true, oneM: false });
  });

  it('flags an extra model as oneM when its value contains [1m]', () => {
    const { models } = deriveClaudeModels({
      oauthAccount: { organizationUuid: ORG },
      additionalModelOptionsCache: [{ value: 'claude-fable-5[1m]' }],
    });
    expect(models.find(m => m.value === 'claude-fable-5[1m]')).toMatchObject({ extra: true, oneM: true, label: 'claude-fable-5[1m]' });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- claudeModels`
Expected: FAIL — `Failed to resolve import "../../electron/services/claudeModels"` (module does not exist yet).

- [ ] **Step 3: Create the module**

Create `electron/services/claudeModels.ts`:

```ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface ClaudeModelOption {
  value: string;        // tai's CustomDropdown keys on `value` (CLI --model alias or id)
  label: string;
  description?: string;
  recommended?: boolean;
  oneM?: boolean;
  extra?: boolean;
}

// Offline fallback, used when claude:models can't detect the account's allowed
// set (e.g. not logged in). Labels carry the current lineup versions.
export const BASE_CLAUDE_MODELS: ClaudeModelOption[] = [
  { value: 'default',    label: 'Default',                 recommended: true },
  { value: 'best',       label: 'Best' },
  { value: 'opus',       label: 'Opus 4.8' },
  { value: 'opus[1m]',   label: 'Opus 4.8 (1M context)',   oneM: true },
  { value: 'sonnet',     label: 'Sonnet 4.6' },
  { value: 'sonnet[1m]', label: 'Sonnet 4.6 (1M context)', oneM: true },
  { value: 'haiku',      label: 'Haiku 4.5' },
  { value: 'opusplan',   label: 'Opus Plan' },
];

function readClaudeUserConfig(): any {
  try {
    return JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude.json'), 'utf8'));
  } catch {
    return null;
  }
}

// Derives the models actually available to this account/org rather than assuming
// every model is allowed. The Claude CLI has no "list models" command, but it
// caches the relevant signals in ~/.claude.json:
//   - additionalModelOptionsCache: account-specific extra models (e.g. Fable)
//   - s1mAccessCache[orgUuid].hasAccess: whether the org can use 1M context
//   - oauthAccount.organizationUuid: the key into s1mAccessCache
// When not logged in (no cache) we fall back to the built-in set.
export function deriveClaudeModels(cfg: any): { models: ClaudeModelOption[]; detected: boolean } {
  if (!cfg || !cfg.oauthAccount) {
    return { models: BASE_CLAUDE_MODELS, detected: false };
  }

  const orgUuid: string | undefined = cfg.oauthAccount.organizationUuid;
  const has1m = !!(orgUuid && cfg.s1mAccessCache?.[orgUuid]?.hasAccess === true);

  const byValue = new Map(BASE_CLAUDE_MODELS.map(m => [m.value, m]));
  const pick = (v: string) => byValue.get(v)!;

  const models: ClaudeModelOption[] = [pick('default'), pick('best')];

  const extras = Array.isArray(cfg.additionalModelOptionsCache) ? cfg.additionalModelOptionsCache : [];
  for (const m of extras) {
    if (m && typeof m.value === 'string') {
      models.push({
        value: m.value,
        label: typeof m.label === 'string' && m.label ? m.label : m.value,
        description: typeof m.description === 'string' ? m.description : undefined,
        extra: true,
        oneM: m.value.includes('[1m]'),
      });
    }
  }

  models.push(pick('opus'));
  if (has1m) models.push(pick('opus[1m]'));
  models.push(pick('sonnet'));
  if (has1m) models.push(pick('sonnet[1m]'));
  models.push(pick('haiku'));
  models.push(pick('opusplan'));

  return { models, detected: true };
}

export function getAvailableClaudeModels(): { models: ClaudeModelOption[]; detected: boolean } {
  return deriveClaudeModels(readClaudeUserConfig());
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- claudeModels`
Expected: PASS — all 6 tests green.

- [ ] **Step 5: Commit**

```bash
git add electron/services/claudeModels.ts tests/unit/claudeModels.test.ts
git commit -m "feat(claude): account/org-aware model derivation from ~/.claude.json"
```

---

### Task 2: Register the `ai:models` IPC handler

**Files:**
- Modify: `electron/services/claude.ts` (import + handler inside `setupClaudeService`, ~line 307)

- [ ] **Step 1: Add the import**

At the top of `electron/services/claude.ts`, alongside the other service imports (after the `import { enrichEnv, resolveBinary } from './platform';` line), add:

```ts
import { getAvailableClaudeModels } from './claudeModels';
```

- [ ] **Step 2: Register the handler**

Inside `setupClaudeService(getWindow)` (line 307), next to the existing `ipcMain.handle('ai:send', ...)` registration, add:

```ts
  // ai:models — which Claude models this account/org can actually use (org
  // allow-lists and 1M gating vary), derived from the CLI cache in ~/.claude.json
  // rather than hardcoded. Falls back to the built-in set when not logged in.
  ipcMain.handle('ai:models', () => getAvailableClaudeModels());
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit -p tsconfig.node.json`
Expected: no errors. (If `tsconfig.node.json` is not the electron config, run the project's main `tsc` from Step in Task 5; either way the import must resolve.)

- [ ] **Step 4: Commit**

```bash
git add electron/services/claude.ts
git commit -m "feat(claude): expose ai:models IPC handler"
```

---

### Task 3: Expose `ai.models` through preload + window typing

**Files:**
- Modify: `electron/preload.ts` (inside the `ai: { … }` block, ~line 72)
- Modify: `src/types/window.d.ts` (inside `tai.ai`, ~line 37)
- Modify: `src/types.ts` (add shared renderer `ClaudeModelOption`)

- [ ] **Step 1: Add the preload binding**

In `electron/preload.ts`, inside the `ai: {` object, after the `setDaemonEnabled` line (line 72), add:

```ts
    models: () => ipcRenderer.invoke('ai:models'),
```

- [ ] **Step 2: Add the renderer-side type**

In `src/types.ts`, add:

```ts
export interface ClaudeModelOption {
  value: string;
  label: string;
  description?: string;
  recommended?: boolean;
  oneM?: boolean;
  extra?: boolean;
}
```

- [ ] **Step 3: Declare `models` on `window.tai.ai`**

In `src/types/window.d.ts`, inside the `ai: {` block, after the `setDaemonEnabled` line (line 37), add:

```ts
        models: () => Promise<{ models: import('../types').ClaudeModelOption[]; detected: boolean }>;
```

- [ ] **Step 4: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add electron/preload.ts src/types/window.d.ts src/types.ts
git commit -m "feat(preload): expose window.tai.ai.models + ClaudeModelOption type"
```

---

### Task 4: Render the live list in QuickSettings (with fallback)

**Files:**
- Modify: `src/components/QuickSettings.tsx`
- Test: `tests/unit/QuickSettings.test.tsx`

- [ ] **Step 1: Write the failing component test**

Create `tests/unit/QuickSettings.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import { QuickSettings } from '../../src/components/QuickSettings';

// Minimal required props; only the model wiring matters here.
const baseProps = {
  visible: true,
  onClose: () => {},
  colorMode: 'high', onColorModeChange: () => {},
  cardAccent: 'brackets', onCardAccentChange: () => {},
  noise: true, onNoiseChange: () => {},
  trustLevel: 'ask' as const, onTrustLevelChange: () => {},
  aiProvider: 'claude' as const, onAIProviderChange: () => {},
  claudeEffort: 'auto', onClaudeEffortChange: () => {},
  expandToolCalls: false, onExpandToolCallsChange: () => {},
  systemNotifications: false, onSystemNotificationsChange: () => {},
};

function openClaudeTab() {
  fireEvent.click(screen.getByText('Claude'));
}

describe('QuickSettings model selector', () => {
  it('shows the live availableModels label for the selected model', () => {
    render(
      <QuickSettings
        {...baseProps}
        claudeModel="claude-fable-5"
        onClaudeModelChange={() => {}}
        availableModels={[{ value: 'claude-fable-5', label: 'Fable 5' }]}
      />,
    );
    openClaudeTab();
    expect(screen.getByText('Fable 5')).toBeInTheDocument();
  });

  it('falls back to the static lineup when availableModels is empty', () => {
    render(
      <QuickSettings
        {...baseProps}
        claudeModel="opus"
        onClaudeModelChange={() => {}}
        availableModels={[]}
      />,
    );
    openClaudeTab();
    // The refreshed static fallback label for `opus`.
    expect(screen.getByText('Opus 4.8')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- QuickSettings`
Expected: FAIL — `availableModels` is not a prop yet, and the static label is still `'Opus'` not `'Opus 4.8'`, so the assertions miss.

- [ ] **Step 3: Refresh the static fallback labels**

In `src/components/QuickSettings.tsx`, replace the `CLAUDE_MODEL_OPTIONS` const (lines 58-67) with versioned labels:

```ts
const CLAUDE_MODEL_OPTIONS = [
  { value: 'default', label: 'Default' },
  { value: 'best', label: 'Best' },
  { value: 'opus', label: 'Opus 4.8' },
  { value: 'opus[1m]', label: 'Opus 4.8 (1M context)' },
  { value: 'sonnet', label: 'Sonnet 4.6' },
  { value: 'sonnet[1m]', label: 'Sonnet 4.6 (1M context)' },
  { value: 'haiku', label: 'Haiku 4.5' },
  { value: 'opusplan', label: 'Opus Plan' },
];
```

- [ ] **Step 4: Add the `availableModels` prop to the interface**

In `QuickSettingsProps` (after `onClaudeModelChange`, line 21), add:

```ts
  availableModels?: { value: string; label: string; description?: string; recommended?: boolean }[];
```

- [ ] **Step 5: Accept the prop and choose the source**

In the `QuickSettings` function signature (line 125), add `availableModels` to the destructured params (e.g. after `onClaudeModelChange`):

```ts
export function QuickSettings({ visible, onClose, colorMode, onColorModeChange, cardAccent, onCardAccentChange, noise, onNoiseChange, trustLevel, onTrustLevelChange, aiProvider, onAIProviderChange, claudeModel, onClaudeModelChange, availableModels, claudeEffort, onClaudeEffortChange, expandToolCalls, onExpandToolCallsChange, systemNotifications, onSystemNotificationsChange }: QuickSettingsProps) {
```

Then, immediately after the `const [updateStatus, setUpdateStatus] = useState(...)` line (line 128), add:

```ts
  const modelOptions = availableModels?.length ? availableModels : CLAUDE_MODEL_OPTIONS;
```

- [ ] **Step 6: Feed the model dropdown from `modelOptions`**

Find the model `CustomDropdown` (the one bound to `value={claudeModel}` / `onChange` calling `onClaudeModelChange`, in the Claude category) and change its `options` prop from `CLAUDE_MODEL_OPTIONS` to `modelOptions`:

```tsx
                  <CustomDropdown
                    value={claudeModel}
                    options={modelOptions}
                    onChange={onClaudeModelChange}
                  />
```

Leave the effort dropdown (`CLAUDE_EFFORT_OPTIONS`) and all other dropdowns untouched.

- [ ] **Step 7: Run the test to verify it passes**

Run: `npm test -- QuickSettings`
Expected: PASS — both tests green.

- [ ] **Step 8: Commit**

```bash
git add src/components/QuickSettings.tsx tests/unit/QuickSettings.test.tsx
git commit -m "feat(settings): render live Claude model list with static fallback"
```

---

### Task 5: Wire prefetch + validation in App.tsx

**Files:**
- Modify: `src/App.tsx`

This is renderer wiring against a huge component; it is verified by typecheck + manual run rather than a dedicated automated test.

- [ ] **Step 1: Import the type**

Ensure `ClaudeModelOption` is imported in `src/App.tsx`. If there is an existing `import { … } from '@/types'` (or `'./types'`), add `ClaudeModelOption` to it; otherwise add:

```ts
import type { ClaudeModelOption } from '@/types';
```

Also confirm `useState` and `useEffect` are imported from `'react'` (add them if missing).

- [ ] **Step 2: Add state**

Just after the `useSettings()` destructure (line 25) / among the other `useState` calls near line 28, add:

```ts
  const [claudeModels, setClaudeModels] = useState<ClaudeModelOption[]>([]);
```

- [ ] **Step 3: Add the prefetch effect**

Among the component's other `useEffect` hooks, add:

```ts
  // Prefetch the Claude models this account/org can actually use. Orgs can
  // restrict models and 1M context is gated per-org, so we don't assume every
  // model is available — ai:models derives the real set from ~/.claude.json.
  useEffect(() => {
    window.tai?.ai?.models?.().then((r) => {
      if (r?.models?.length) setClaudeModels(r.models);
    }).catch(() => {});
  }, []);
```

- [ ] **Step 4: Add the validation effect**

After the prefetch effect, add:

```ts
  // If the persisted model isn't in the account's allowed set (e.g. access was
  // revoked, or a stale value), fall back to the recommended/first model so we
  // never spawn the CLI with a disallowed --model. Runs once the live list and
  // the loaded settings are both available, covering the settings-load race.
  useEffect(() => {
    if (!configLoaded || !claudeModels.length) return;
    const current = config['claude.model'] || 'sonnet';
    if (claudeModels.some((m) => m.value === current)) return;
    setSetting('claude.model', claudeModels.find((m) => m.recommended)?.value ?? claudeModels[0].value);
  }, [configLoaded, claudeModels, config['claude.model'], setSetting]);
```

- [ ] **Step 5: Pass `availableModels` to QuickSettings**

In the `<QuickSettings … />` JSX (around line 234, next to `claudeModel={config['claude.model'] || 'sonnet'}`), add:

```tsx
        availableModels={claudeModels}
```

- [ ] **Step 6: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx
git commit -m "feat(app): prefetch + validate account-aware Claude model list"
```

---

### Task 6: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Typecheck the whole project**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: PASS, including the new `claudeModels` and `QuickSettings` suites. (Vitest is capped at 2 forks via `tests/vitest.config.ts`.)

- [ ] **Step 3: Production build sanity**

Run: `npm run build`
Expected: `tsc && vite build` completes with no errors.

- [ ] **Step 4: Manual smoke check**

Run: `npm run dev`, open Quick Settings → Claude tab, and confirm:
  - Logged in: the dropdown lists models from `~/.claude.json` (1M variants only if the org has access; any extra models like Fable appear).
  - The selected model persists across reopen.
  - With a previously-persisted model now disallowed, the selection auto-corrects to the recommended/first allowed model.

- [ ] **Step 5: Final commit (if any manual fixes were needed)**

```bash
git add -A
git commit -m "chore: verification fixes for account-aware model picker"
```

---

## Self-review notes

- **Spec coverage:** Data source → Task 1; `getAvailableClaudeModels` + `ai:models` handler → Tasks 1-2; preload `models` → Task 3; App prefetch/validation/`availableModels` → Task 5; QuickSettings dynamic source + refreshed labels → Task 4; testing (unit + component) → Tasks 1 & 4; full verify → Task 6. otto and the orchestrator picker are explicitly out of scope (no tasks), matching the spec.
- **Type consistency:** `ClaudeModelOption` (`value`/`label`/`description`/`recommended`/`oneM`/`extra`) is declared in `electron/services/claudeModels.ts` (main) and `src/types.ts` (renderer) with identical shape; `window.tai.ai.models()` returns `{ models: ClaudeModelOption[]; detected: boolean }`, matching `getAvailableClaudeModels`/`deriveClaudeModels`. `modelOptions`/`availableModels` use `value`, consistent with the existing `CustomDropdown` (`{ value, label }`).
- **Deviation from spec:** derivation logic lives in a new `claudeModels.ts` (testability), not inline in `claude.ts`. Noted in the header.
