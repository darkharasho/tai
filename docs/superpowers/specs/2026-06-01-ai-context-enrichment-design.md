# P0 — AI Context Enrichment (Design)

**Date:** 2026-06-01
**Status:** Design — awaiting review
**Parent:** [Warp AI & Detection Deep Dive](./2026-06-01-warp-ai-detection-deep-dive.md) (recommendation P0)
**Decisions baked in:** delivery model = **hybrid (push + pull)**; **provider parity** for codex/gemini; **richness** = cwd + git branch + exit code + duration.

## Goal

Give the AI agent Warp-style *ambient awareness* of what just happened in the terminal — recent commands, exit codes, cwd, git branch — across all three providers (claude / codex / gemini), without requiring the agent to choose to call a tool. Keep an on-demand tool for deep lookups.

## Why this is the right scope

TAI already captures everything needed (`SegmentedBlock`: command, output, exitCode, duration, cwd) and already has **both** delivery channels in skeletal form:

- **Push:** `TerminalSession.tsx:534-569` prepends a `<system>` block to every AI prompt. It is provider-agnostic (plain message text, so claude/codex/gemini all receive it) and already pushes `Working directory: ${cwd}` each turn.
- **Pull:** `mcpHistoryServer.ts` exposes a `TerminalHistory` MCP tool over a per-session JSON file fed by `TerminalSession.tsx:144` (`ai.updateHistory`). Currently wired into **claude only**.

Two real gaps: the push channel carries no recent-command context, and the pull channel is claude-only and thin (command/exit/output, no cwd/branch/duration). P0 closes both.

## Architecture

### A. Push — per-turn recent-context section (primary win)

New pure helper `src/utils/aiContext.ts`:

```ts
buildRecentContext(
  items: DisplayItem[],
  sinceId: string | null,
  opts?: { maxCommands?: number; maxOutputChars?: number; budgetChars?: number },
): { text: string; lastId: string | null }
```

Behavior:
- Select **command** blocks completed *after* `sinceId` (the last block already shown to the AI), in order, capped at `maxCommands` (default 5).
- Render compact lines: `` $ <command> `` plus ` [exit N]` only when exit code is non-zero.
- Include a truncated **output snippet only** for (a) the most recent command and (b) any non-zero-exit command — cap `maxOutputChars` (default ~800) / ~15 lines each. Other commands show just the command line.
- Prepend a status line when known: `cwd: <cwd> (git: <branch>)`.
- Enforce a total `budgetChars` cap (default ~1500): drop oldest commands' output first, then oldest commands, until it fits.
- Return `text: ''` and unchanged `lastId` when there are **no new commands** since `sinceId` (avoids bloat during rapid back-and-forth; the existing `Working directory` line still carries cwd).

Wiring in `handleAIRequest` (`TerminalSession.tsx`):
- Add `lastContextBlockIdRef` (sibling to `preambleSentRef`).
- Call `buildRecentContext(displayItems, lastContextBlockIdRef.current, ...)`; if `text` is non-empty, push it into `lines` as a `recent terminal activity:` section of the existing `<system>` block.
- After a successful `send`, set `lastContextBlockIdRef.current = lastId`.
- Reset the ref in the same place `preambleSentRef` is reset (`TerminalSession.tsx:138`).

This makes the ambient context provider-agnostic for free — no per-provider work for push.

### B. Pull — enrich the existing history tool

- `TerminalSession.tsx:144` `updateHistory` entries gain `cwd`, `durationMs`, `timestamp` (already carry command/output/exitCode), and `gitBranch` when available.
- `mcpHistoryServer.ts::formatHistory` renders the new fields (e.g. `$ cmd  [exit 1]  (~/proj, git:main, 1.2s)`).
- Tool description unchanged; richer payload only.

### C. Provider parity

- **Push (A):** automatic — the `<system>` block already reaches all three providers, giving codex and gemini full ambient parity with no per-provider work. This is the parity story for P0.
- **Pull (B):** the `TerminalHistory` MCP tool stays **claude-only** in P0. Codex and gemini-ACP each use their own MCP-config mechanism (not claude's `--mcp-config <json>` flag), so wiring the pull tool into them is a separate, per-CLI investigation — **deferred to a documented follow-up**. Push (A) already covers their ambient-context need; the residual gap is only *deep on-demand history lookup* for codex/gemini.

### git branch source

P0 derives the branch in the **main process** via a cached `git -C <cwd> rev-parse --abbrev-ref HEAD`, keyed by cwd, invalidated when cwd changes (no shell-integration change required). Cleaner alternative — add `git_branch` to the OSC 6973 `precmd` payload (`src/types/shellHooks.ts` + shell hook script) — is noted as a follow-up, not P0.

## Data flow

```
SegmentedBlock (command, output, exitCode, duration, cwd)
   │
   ├─► TerminalSession.displayItems
   │       ├─ buildRecentContext() ──► <system> block ──► provider.send() ──► PUSH (all 3)
   │       └─ ai.updateHistory() ────► history JSON ──► TerminalHistory MCP ──► PULL (claude, +codex)
```

## Testing (TDD)

`tests/unit/aiContext.test.ts` — `buildRecentContext`:
- selects only blocks after `sinceId`; returns correct `lastId`
- caps at `maxCommands`
- annotates `[exit N]` only for non-zero exits
- includes output only for the most-recent command and failed commands
- truncates output to `maxOutputChars`
- enforces `budgetChars`, dropping oldest output first then oldest commands
- returns empty text + unchanged `lastId` when no new commands
- emits `cwd (git: branch)` status line when branch present, cwd-only when absent

Plus: enriched history entry shape (cwd/duration/timestamp present); `formatHistory` renders them; `codex.ts` spawn args include `--mcp-config` pointing at the history server.

## Out of scope

ONNX classifier and the rest of P1; autodetect UX (P2); `!` escape (P3); mid-turn streaming of context; **codex and gemini pull-tool wiring** (deferred — push covers their ambient context; deep on-demand lookup stays claude-only for now).

## Risks & mitigations

- **Prompt bloat / token cost** — delta-only injection + `budgetChars` cap + empty-when-no-change.
- **Privacy** — terminal output already reaches the agent (existing tool + cwd line); the push section widens this. Acceptable for a terminal AI; documented. No new network surface.
- **Stale git branch** — cwd-keyed cache refreshes on cwd change; worst case a branch label lags until the next cwd change. Low impact.
- **Gemini pull gap** — explicitly documented; push parity unaffected.
