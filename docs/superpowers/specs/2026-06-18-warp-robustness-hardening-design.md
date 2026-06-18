# Warp-Grade Robustness Hardening — Design

**Date:** 2026-06-18
**Status:** Approved (brainstorming) → pending implementation plan
**Theme:** Robustness & stability. No new features. Every change adds a bound, a
timeout, a cleanup, or a guard.

## Background

TAI has absorbed much of Warp's terminal/block/session model over prior deep
dives (term-first emulator, block convergence, AI/SSH detection, secret
redaction). This pass is a **proactive audit**: systematically diff TAI's four
robustness-critical subsystems against Warp's hardening and close gaps before
they bite users.

A four-agent audit (terminal/PTY/parsing, blocks/rendering/memory,
remote/SSH/daemon, AI/streaming) surfaced ~40 candidate findings. A verification
pass against the real code confirmed the high-value ones and **debunked
several**, which is why this is a TDD program rather than a blind fix-list:

- **Confirmed:** no cap on `displayItems` (session blocks grow unbounded —
  genuine P0); unguarded `stdin.write` in `claude.ts` (454/614/656); no
  idle/max timeout on provider spawns; `sessionRestore` swallows quota errors
  (`catch {}`); `termEmulator` cursor/IL allocate synchronously *before* its
  compaction (`COMPACT_AT=1024`) engages.
- **Debunked / overstated:** `remoteSsh.execute` already has a 30s timeout (the
  "no SSH timeout" findings were wrong); `BlockSegmenter` is a per-tab `useRef`
  created once, so "callback leak across remount" is a non-issue;
  `termEmulator` already enforces `MAX_PENDING_ESC`, `COMPACT_AT`,
  `FROZEN_MAX_LINES` / `_trimFrozen`, so several "unbounded" claims are already
  partially mitigated.

**Principle:** each fix begins as a failing test written against the actual
code. If the test can't be made to fail, the finding was a false positive and is
dropped. This filters the ~30% bad signal automatically.

## Approach

A TDD hardening program delivered as **severity-tiered batches**, cutting across
five themes. Each batch is independently shippable and verified in-app before the
next.

### Themes

| Theme | Covers |
|---|---|
| **A · Bounded memory** | Cap session block count; cap stored per-block output; cap cursor/IL/column allocation in `termEmulator`; cap OSC/DCS payload at source; quota-aware `sessionRestore`. |
| **B · No infinite hangs** | Idle/max timeout on claude/codex/gemini spawns; per-call timeout on daemon `executeTool`; heartbeat pong timeout; MCP-ready timeout. |
| **C · Clean lifecycle** | Kill provider + drop listener on tab-close-mid-AI; reject pending on SSH/daemon exit; guard `stdin.write`; clear stray timers; purge stale temp files on startup. |
| **D · Malformed-input safety** | `ansiToHtml` NaN guard on truncated SGR; SSH depth-drift hard reset on `SSH_CLOSED_RE`; escape-parse hardening. |
| **E · No main-process crashes** | Catch unhandled rejections in `gemini:send` / daemon exit; surface provider stderr (auth/rate-limit) instead of swallowing. |

### Batches

**Batch 1 — P0 (crash / hang / data-loss / leak).**
- Bound `displayItems` to a max block count with tail-eviction (Theme A).
- Idle + max-lifetime watchdog on each provider spawn that kills the process and
  emits a terminal `done` (Theme B).
- Tab-close-mid-AI: unmount effect kills the AI request and drops the IPC
  listener (Theme C).
- Guard `stdin.write` in try/catch; on failure surface an error and settle the
  turn (Theme C).
- Per-call timeout on daemon `executeTool` via `Promise.race`, clearing the
  pending entry on timeout (Theme B).

**Batch 2 — P1 (degradation).**
- Cap stored per-block streaming output (head/tail-preserving) (Theme A).
- Cap `termEmulator` `_row`/`_col` and IL/DL `n` to sane maxima (Theme A).
- Cap OSC/DCS payload at `BlockSegmenter._routeChunk` (Theme A).
- `sessionRestore`: catch `QuotaExceededError`, shed oldest tab data, surface
  once (Theme A).
- `ansiToHtml`: bounds-check 256/RGB color parse, fall back gracefully on NaN
  (Theme D).
- `SSH_CLOSED_RE`: unconditionally reset `_sshDepth`/`_cmdDepth` and clear SSH
  state regardless of depth counters (Theme D).
- Heartbeat pong timeout + MCP-ready timeout on the daemon path (Theme B).
- Reject pending on SSH/daemon process exit so callers unblock (Theme C).
- Wrap main-process async handlers; classify provider stderr
  (auth/rate-limit/permission) into structured errors (Theme E).

**Batch 3 — P2 (polish).**
- Clear stray timers (`daemonToastTimerRef` et al.) on unmount (Theme C).
- Purge stale `/tmp/tai-mcp-*`/`tai-history-*` files on startup (Theme C).
- Warn when a provider exits with a non-empty partial buffer (possible truncated
  response) (Theme E).
- Stable conversation-group key to avoid reorder flicker (Theme A/rendering).

## Adversarial-input harness

New `tests/unit/adversarialInput.test.ts` backed by a
`tests/fixtures/pathological.ts` generator producing: binary/NUL spew, invalid
UTF-8, a ~10 MB single line, unterminated `OSC`/`DCS`, `ESC[999999B`,
`ESC[999999L`, deeply nested SGR, BEL floods.

These feed through `termEmulator.feed` → `BlockSegmenter` →
`ansiToHtml` and assert: **no throw**, **bounded line/char counts**, **bounded
wall-time**. This is the regression net for Themes A & D and the proof the bounds
hold. It is written first (red) and drives the Batch 2 parse/bound fixes.

## Data-flow & error-handling rules

1. **Never silently empty.** Every bound preserves a head or tail of real data.
   (Empties already regressed this project once — see term-first overhaul memory.)
2. **Settle exactly once.** Every timeout/exit path rejects-or-resolves each
   pending request exactly once and emits a terminal `done`/error to the renderer,
   so the UI never stays "thinking."
3. **One place to tune.** Caps are named constants co-located with existing ones
   (`MAX_PENDING_ESC`, `COMPACT_AT`, …).
4. **Verify the finding first.** A finding with no reproducible failing test is
   dropped, not implemented.

## Affected files (anticipated)

- Bounds: `src/components/TerminalSession.tsx`, `src/utils/termEmulator.ts`,
  `src/components/BlockSegmenter.ts`, `src/utils/sessionRestore.ts`,
  `src/components/CommandBlock.tsx`.
- Timeouts/lifecycle: `electron/services/claude.ts`, `codex.ts`, `gemini.ts`,
  `gemini-acp.ts`, `remoteDaemonProxy.ts`, `remoteSsh.ts`, `mcpRemoteServer.ts`.
- Parse safety: `src/utils/ansiToHtml.ts`, `src/components/BlockSegmenter.ts`.
- Tests: `tests/unit/adversarialInput.test.ts`, `tests/fixtures/pathological.ts`,
  plus targeted unit tests per fix.

(Exact line targets are re-verified at implementation time; the audit's line
numbers are treated as leads, not facts.)

## Testing & verification

- Run via `npm test` (the project wrapper — NOT bare `npx vitest run`, which
  picks up the electron-renderer fs shim and fails). Limit `--maxWorkers=2`.
- Baseline: 67 test files green. Each batch: new red tests → fix → green → `tsc`
  clean → in-app smoke test (esp. long sessions, huge output, interactive SSH,
  mid-stream provider kill) before starting the next batch.

## Out of scope

- New features of any kind.
- Cell-grid/Alacritty reflow port, ONNX classifier, DCS-hook migration (already
  dropped in prior deep dives).
- Findings that fail to reproduce as a failing test.
