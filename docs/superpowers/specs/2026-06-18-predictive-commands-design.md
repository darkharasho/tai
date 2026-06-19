# Predictive Commands — Closing the Warp Gaps — Design

**Date:** 2026-06-18
**Status:** Approved (brainstorming) → pending implementation plan
**Goal:** Bring TAI's predictive-command surface up to Warp's, without a server
or ONNX dependency. Four major gaps, one cohesive spec, four shippable phases.

## Background

A head-to-head map of Warp OSS vs TAI found TAI has solid versions of history
parsing, ghost text, bash completions, and AI error-fix, but is meaningfully
behind on four fronts:

1. **Ghost text is prefix-only and global** — score `1 + pos/total`, no
   frequency curve, no per-directory awareness. (`src/hooks/useGhostText.ts`)
2. **No zero-state next-command prediction** — Warp suggests a likely next
   command after a block completes; TAI suggests nothing on an empty composer.
3. **Completions have no semantic knowledge** — bash `compgen` only
   (`electron/services/pty.ts:335`), so no `git che`→`checkout`, no flag help.
4. **No workflows / command palette** — Warp has parameterized snippets and a
   Cmd-K launcher; TAI has neither.

Confirmed code facts grounding this design:
- Finished blocks already carry `cwd`, `exitCode`, `gitBranch` (`src/types.ts`).
- History is loaded flat via `getShellHistory(500)` (`pty.ts:335`,
  `TerminalSession.tsx:264`).
- userData JSON persistence is already used (`electron/main.ts`,
  `services/notify.ts`).
- Modal infra exists (`ConfirmModal`, `SettingsOverlay`, `WhatsNewModal`).

## Architecture — the shared substrate

Three of the four features need command history **with metadata**. That data
already exists, latent, on finished blocks. The foundation is a **Command
Index** that aggregates it once and feeds the rest.

### Command Index (`src/utils/commandIndex.ts`)

A pure, aggregated, capped table keyed by command string:

```ts
interface CommandStat {
  command: string;
  count: number;            // total runs seen
  lastTs: number;           // most-recent run (ingest-stamped if block has none)
  cwdCounts: Record<string, number>; // runs per directory (capped buckets)
  lastExitCode?: number;
}
interface CommandIndex {
  stats: Record<string, CommandStat>;
  // adjacency for co-occurrence (Gap 2): what tends to follow each command
  next: Record<string, Record<string, number>>;
}
```

Operations (all pure, unit-testable):
- `ingestBlock(index, { command, cwd, exitCode, ts, prevCommand })` — updates
  `stats` and `next[prevCommand][command]`.
- `ingestHistoryLines(index, lines)` — seed from parsed shell history (no cwd).
- `frecency(stat, now, cwd)` — the ranking score (see Gap 1).
- `topNext(index, prevCommand, n)` — co-occurrence prediction (see Gap 2).
- `cap(index)` — evict lowest-frecency entries and smallest cwd/next buckets
  to stay under `MAX_INDEX_COMMANDS` / `MAX_CWD_BUCKETS` / `MAX_NEXT_BUCKETS`.

### Persistence (`electron/services/commandIndexStore.ts`)

Capped JSON in `app.getPath('userData')/command-index.json`. **No native SQLite
dependency** — matches TAI's existing userData/localStorage style and the
robustness sweep's bounds discipline. Writes are debounced; load is defensive
(corrupt/oversized JSON → empty index). Exposed to the renderer via a small IPC
surface (`pty:commandIndex:get`, `:ingest`, `:flush`).

**Decision (locked):** capped JSON, not SQLite. Revisit only if profiling shows
the index is too big for JSON (it won't be at the chosen caps).

The renderer keeps the index in memory for synchronous ranking; the main process
owns persistence. Blocks are ingested as they finalize (the existing `onBlock`
finalize site in `TerminalSession.tsx`).

## Gap 1 — Frecency + cwd-aware ghost text

Replace `useGhostText`'s linear score with a frecency score over the Command
Index, still **prefix-anchored** (fish/zsh inline behavior — no jarring fuzzy
jumps in ghost text):

```
score(stat, now, cwd) =
    W_FREQ   * log(stat.count + 1)
  + W_RECENT * recencyDecay(now - stat.lastTs)   // exp/half-life decay
  + W_CWD    * (stat.cwdCounts[cwd] > 0 ? log(stat.cwdCounts[cwd]+1) : 0)
```

Weights are named consts in one place. Prefix match stays case-insensitive,
single-line. The rigid `>= 5` char gate becomes a configurable
`GHOST_MIN_PREFIX` (default lower, e.g. 2–3). Acceptance unchanged (Tab / →).

- **Files:** `src/hooks/useGhostText.ts` (consume index + frecency),
  `src/utils/commandIndex.ts` (`frecency`).
- **Data flow:** composer value + current cwd → `frecency` over prefix-matched
  stats → best command → ghost text.
- **Testing:** pure `frecency` unit tests (frequency dominance, recency decay,
  cwd boost flips ranking); `useGhostText` test asserts cwd-local command wins.

## Gap 2 — Zero-state next-command prediction

When the composer is empty after a block finishes, predict the likely next
command and show it as a **dismissible inline suggestion** (ghost-text styling).
Hybrid sourcing:

1. **Heuristic (instant, offline)** — `src/utils/nextCommand.ts`:
   - Chain rules: `git add`→`git commit`, `cd <dir>`→`git status` (if dir is a
     repo), `npm install`→`npm run dev`, `mkdir X`→`cd X`, etc. (small curated table).
   - History **co-occurrence**: `commandIndex.topNext(prevCommand)`.
   - Failed command → hand off to the existing `ErrorAffordance` fix flow rather
     than guessing a next command.
2. **AI refine (optional, off by default)** — a debounced, cancellable call via
   the existing providers that can replace the heuristic guess when it returns.
   Never blocks the composer; if it errors or is slow, the heuristic stands.

- **Files:** `src/utils/nextCommand.ts` (pure rules + co-occurrence),
  `src/components/TerminalInput.tsx` (render zero-state suggestion), a settings
  flag for AI refine.
- **Testing:** pure rule tests (each chain rule; co-occurrence ranking;
  failed-command suppression); AI refine is behind a flag and mock-tested.

## Gap 3 — Curated completion specs

A lightweight, data-only spec format for ~15–20 common CLIs; `compgen` remains
the fallback for unknown commands and all path/file completion.

```ts
// src/completions/specs/git.ts
interface CompletionSpec {
  command: string;                 // "git"
  subcommands: { name: string; description: string; subcommands?: ... }[];
  options: { names: string[]; description: string; takesArg?: boolean }[];
}
```

- **Resolver** (`src/completions/resolveCompletion.ts`): tokenize the input line,
  walk the spec tree to the current token, return ranked candidates (subcommands
  / flags) with descriptions. Prefix + light fuzzy on the final token. Unknown
  command or a path-position token → defer to the existing `compgen` path
  (`pty.ts`), which keeps its 50-result cap + 2s timeout.
- **Specs:** `src/completions/specs/{git,docker,npm,pnpm,yarn,kubectl,cargo,gh,ssh,...}.ts`.
  Plain data, no shell execution → fast unit tests.
- **UX:** reuse the existing completion popup, add a description column.
- **Files:** `src/completions/` (new dir), wiring in `TerminalInput.tsx` Tab
  handler to try the spec resolver before/alongside `compgen`.
- **Testing:** resolver unit tests per spec (`git ch`→checkout/cherry-pick;
  `docker ` → run/build/ps; flag completion `git commit -`→`-m`/`--amend`);
  fallback-to-compgen path asserted for unknown commands.

## Gap 4 — Workflows + command palette (local)

- **Workflows** (`src/utils/workflows.ts` + `commandIndexStore`-style userData
  JSON): parameterized snippets, e.g. `deploy {{env}}`. A run dialog prompts for
  each `{{param}}` (Tab cycles placeholders, Warp-style), then inserts or runs.
  CRUD is local-only, capped, no cloud.
- **Command palette** (`src/components/CommandPalette.tsx`): a Cmd-K modal
  (reusing the existing modal infra) with fuzzy search across **history +
  workflows + known commands (from specs)**; arrow-select, Enter to insert/run,
  Cmd-Enter to run immediately.
- **Files:** `src/components/CommandPalette.tsx` (+ css), `src/utils/workflows.ts`,
  a keybinding registration for Cmd-K (respecting the existing key-routing rules
  so it doesn't fire while xterm/inputs own the keys).
- **Testing:** workflow param parsing/substitution (pure); palette result
  ranking/merge (pure); a component test for open/filter/select/dismiss.

## Error handling, performance, bounds

- All ranking / spec / heuristic logic is **pure functions** over the index —
  fast unit tests, no shell or AI needed.
- The Command Index is **bounded** (`MAX_INDEX_COMMANDS`, `MAX_CWD_BUCKETS`,
  `MAX_NEXT_BUCKETS`) with frecency-based eviction; persistence writes are
  **debounced**; load is defensive (corrupt/oversized → empty), consistent with
  the robustness sweep.
- AI refine (Gap 2) is **debounced, cancellable, off by default**; never blocks
  input.
- Completion resolver keeps the existing **2s/`compgen` timeout** fallback.
- Cmd-K respects existing **key-routing** (no hijack while a REPL/xterm owns keys).

## Phasing (four independently-shippable sub-plans)

- **P1 — Command Index + frecency ghost text.** Foundation + highest-value win.
  Ship: `commandIndex.ts`, `commandIndexStore.ts` + IPC, block ingestion,
  frecency in `useGhostText`.
- **P2 — Zero-state next-command.** Heuristic first (chain rules +
  co-occurrence), then optional AI refine behind a flag.
- **P3 — Curated completion specs.** Resolver + initial spec set + Tab wiring +
  compgen fallback.
- **P4 — Workflows + command palette.** Local snippets + Cmd-K palette.

Each phase leaves the suite green, `tsc` clean, and is verifiable in-app before
the next.

## Out of scope

- Cloud-synced workflows / accounts.
- ONNX/server-side suggestion models (Warp's closed pieces).
- A full Fig-style spec engine (hundreds of CLIs, dynamic subprocess args) —
  curated specs + compgen fallback is the chosen 80% point.
- Replacing the shell-vs-AI input classifier (already Warp-informed).

## Testing & verification

- `npm test` (the project wrapper, `--maxWorkers=2`), baseline 589 files green;
  each phase adds pure-function unit tests + a focused component test where a UI
  surface changes.
- In-app smoke per phase: P1 — cwd-local command outranks a global one in ghost
  text; P2 — `git add` then empty composer suggests `git commit`; P3 — `git ch`
  Tab offers `checkout` with description; P4 — Cmd-K finds a saved workflow and
  runs it with a param.
