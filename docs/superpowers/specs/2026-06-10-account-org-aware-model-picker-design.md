# Account/org-aware Claude model picker (tai)

**Date:** 2026-06-10
**Status:** Approved (design)
**Ported from:** sai commit `7623aee` — "feat: account/org-aware Claude model picker (Opus 4.8, Fable 5)"

## Problem

tai's Claude model dropdown is a hardcoded list (`CLAUDE_MODEL_OPTIONS` in
`src/components/QuickSettings.tsx`). It advertises every model regardless of
what the signed-in account/org can actually use:

- Some orgs restrict the available model set.
- 1M-context access (`sonnet[1m]`, `opus[1m]`) is gated per-org.
- Accounts may have extra account-specific models (e.g. Fable) that the static
  list never shows.

sai solved this by deriving the list at runtime from the Claude CLI's own cache
in `~/.claude.json`. tai wraps the same `claude` CLI (`spawn('claude',
['--model', <value>])`) using the same alias format (`opus`, `sonnet[1m]`,
etc.), so the mechanism ports almost directly.

## Goal

Replace the hardcoded model list with a runtime-derived, account/org-aware list,
surfacing only models the account can actually use. Keep a static list as an
offline fallback (used when not logged in), refreshed to the current lineup with
versioned labels. No change to how the CLI is invoked — `--model` still receives
the selected option's `value`.

## Non-goals

- **otto is out of scope.** It uses the Claude Agent SDK with full model IDs
  (`claude-opus-4-7`), not CLI aliases, so `~/.claude.json` is a poor fit; it
  will be revisited separately.
- No orchestrator/swarm model picker (tai has none, unlike sai).
- Codex and Gemini model lists are unchanged.
- No change to CLI invocation, effort handling, or persistence storage.

## Data source

The Claude CLI has no "list models" command, but it caches the relevant signals
in `~/.claude.json`:

- `oauthAccount.organizationUuid` — the gate key.
- `s1mAccessCache[orgUuid].hasAccess` — whether the org can use 1M context.
- `additionalModelOptionsCache` — account-specific extra models (array of
  `{ value, label, description }`).

When the file is missing or has no `oauthAccount` (not logged in), fall back to
the built-in base list.

## Design

### 1. Main process — `electron/services/claude.ts`

`fs`, `os`, `path` are already imported here.

- New type:
  ```ts
  export interface ClaudeModelOption {
    value: string;        // tai's dropdown keys on `value`, not sai's `id`
    label: string;
    description?: string;
    recommended?: boolean;
    oneM?: boolean;
    extra?: boolean;
  }
  ```
  > Field name is `value` (not sai's `id`) so the generic `CustomDropdown`
  > — which expects `{ value, label }` — needs no change.

- `BASE_CLAUDE_MODELS: ClaudeModelOption[]` — offline fallback, refreshed lineup
  with **versioned labels**:
  - `default` — "Default" (recommended)
  - `best` — "Best"
  - `opus` — "Opus 4.8"
  - `opus[1m]` — "Opus 4.8 (1M context)"
  - `sonnet` — "Sonnet 4.6"
  - `sonnet[1m]` — "Sonnet 4.6 (1M context)"
  - `haiku` — "Haiku 4.5"
  - `opusplan` — "Opus Plan"

- `readClaudeUserConfig(): any` — `JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude.json'), 'utf8'))`, returns `null` on any error.

- `getAvailableClaudeModels(): { models: ClaudeModelOption[]; detected: boolean }`:
  - Read config. If no config or no `oauthAccount` → `{ models: BASE_CLAUDE_MODELS, detected: false }`.
  - `orgUuid = cfg.oauthAccount.organizationUuid`; `has1m = !!cfg.s1mAccessCache?.[orgUuid]?.hasAccess`.
  - Build list: `default`, `best`, then any `additionalModelOptionsCache`
    entries (mapped to `{ value, label, description, extra:true, oneM: value.includes('[1m]') }`),
    then `opus`, (`opus[1m]` only if `has1m`), `sonnet`, (`sonnet[1m]` only if
    `has1m`), `haiku`, `opusplan`.
  - Return `{ models, detected: true }`.

- Register inside `setupClaudeService()` (claude.ts:307), alongside the other
  `ipcMain.handle` calls:
  ```ts
  ipcMain.handle('ai:models', () => getAvailableClaudeModels());
  ```
  > `ai:`-prefixed to match tai's existing Claude channels (`ai:send`, `ai:approve`).

### 2. Preload — `electron/preload.ts`

Add to the existing `ai: { … }` block:
```ts
models: () => ipcRenderer.invoke('ai:models'),
```
Exposed to the renderer as `window.tai.ai.models()`.

### 3. App wiring — `src/App.tsx`

- New state: `const [claudeModels, setClaudeModels] = useState<ClaudeModelOption[]>([])`.
- Prefetch on mount:
  ```ts
  useEffect(() => {
    window.tai?.ai?.models?.().then(r => {
      if (r?.models?.length) setClaudeModels(r.models);
    }).catch(() => {});
  }, []);
  ```
- Re-validate persisted choice against the allowed set, so we never spawn the
  CLI with a disallowed `--model` (covers revoked access / stale persisted
  value, and the settings-load race):
  ```ts
  useEffect(() => {
    if (!claudeModels.length) return;
    const current = config['claude.model'] || 'sonnet';
    if (claudeModels.some(m => m.value === current)) return;
    setSetting('claude.model', claudeModels.find(m => m.recommended)?.value ?? claudeModels[0].value);
  }, [claudeModels, config['claude.model']]);
  ```
- Pass `availableModels={claudeModels}` into `<QuickSettings>`.

### 4. UI — `src/components/QuickSettings.tsx`

- New optional prop:
  `availableModels?: { value: string; label: string; description?: string; recommended?: boolean }[]`.
- Choose the source: `const modelOptions = availableModels?.length ? availableModels : CLAUDE_MODEL_OPTIONS;`
- Feed the model `CustomDropdown` from `modelOptions` instead of the const.
- `CLAUDE_MODEL_OPTIONS` stays as the in-file fallback, labels refreshed to the
  versioned lineup above. `CustomDropdown` is generic and **unchanged**.

### 5. Persistence

Unchanged. Model still persists as `config['claude.model']` in tai's
`settings.json` via the existing `useSettings` / `config:set` path. Default
remains `'sonnet'`. The new validation effect corrects an out-of-set persisted
value after the live list loads.

## Testing

Match tai's existing test runner/locations (vitest, capped at 2 workers per the
machine's global setting).

- Unit tests for `getAvailableClaudeModels()`:
  - No `~/.claude.json` (or no `oauthAccount`) → returns `BASE_CLAUDE_MODELS`, `detected:false`.
  - Org with `s1mAccessCache[orgUuid].hasAccess === true` → `opus[1m]` / `sonnet[1m]` present.
  - Org without 1M access → 1M variants absent.
  - `additionalModelOptionsCache` populated → extra model appended with `extra:true`.
- `QuickSettings` render test:
  - With `availableModels` provided → dropdown lists those options.
  - Without (`[]` / undefined) → falls back to `CLAUDE_MODEL_OPTIONS`.

## Files touched

- `electron/services/claude.ts` — types, base list, config reader, derivation fn, IPC handler.
- `electron/preload.ts` — expose `ai.models`.
- `src/App.tsx` — prefetch state, validation effect, pass `availableModels` down.
- `src/components/QuickSettings.tsx` — `availableModels` prop, dynamic source, refreshed fallback labels.
- Tests — new unit + component tests.
