# Warp ↔ TAI block/card convergence (2026-06-10)

Deep-dive comparison of warpdotdev/warp (OSS, AGPLv3, cloned at `../warp-oss`)
against TAI's card pipeline, focused on **functionality, stability, and use** of
blocks/cards. Follows the 2026-06-01 AI/detection deep-dive (P0–P2 shipped);
this spec covers the block/card surface.

## How Warp does blocks (verified in source)

- **Model** (`app/src/terminal/model/block.rs`): a Block owns a `HeaderGrid`
  (prompt+command, immutable after preexec) and an `output_grid` (`BlockGrid`,
  streaming until precmd marks it `finished`). State machine:
  `BeforeExecution → Executing → DoneWithExecution | DoneWithNoExecution`.
  Metadata per block: pwd, git branch, venv/conda, exit code, start/completed
  timestamps, `did_execute`.
- **Segmentation**: DCS preexec/precmd/command-finished hooks injected via
  shell bootstrap (`app/assets/bundled/bootstrap/{bash,zsh,fish}.sh`), with
  session-id validation. No blocks while alt-screen is active
  (`model/alt_screen.rs` keeps a separate grid).
- **Rendering** (`blockgrid_renderer.rs`): cell-grid storage; only visible rows
  render (virtualization); display is unbounded but *serialization* is capped
  (5000 styled lines for restore, 50 plain for AI/notifications). Sticky
  command header capped at 50% of viewport.
- **Scroll**: auto-follow only while pinned to bottom; selection cleared on
  resize; reflow logic ported from Alacritty
  (`model/grid/grid_storage/resize.rs`).
- **Interactions** (`block_list_element.rs`, `model/blocks/selection.rs`):
  multi-block drag selection with block-list anchors; context menu = copy
  command / copy output / copy both, re-run, bookmark, share, save-as-workflow;
  exit-code + duration affordances on hover; regex find across blocks
  (`model/find.rs`, lazy DFA).
- **Stability**: exit codes 130 (SIGINT) / 141 (SIGPIPE) not treated as
  failure; blocks without preexec get `did_execute=false`; typeahead fallback
  when shell integration is missing (`model/early_output.rs`); session restore
  of last 100 blocks/session from SQLite (`persistence/block_list.rs`); PTY
  reads decoupled through a coalescing wakeup channel (`event_listener.rs`).

## TAI today and the verified jank

Pipeline: PTY → IPC → `TerminalSession.tsx` → `HiddenXterm`/`BlockSegmenter`
(OSC 133 + OSC 6973 hooks, legacy prompt-regex fallback) → `displayItems` →
`BlockList.tsx` → `CommandBlock.tsx` (ansiToHtml → dangerouslySetInnerHTML).
Streaming is RAF-coalesced (good). Verified jank, ranked:

1. **Scroll yank** — `BlockList.tsx:67-69` force-scrolls to bottom on *every*
   items change, with no "user is reading scrollback" guard. Streaming output
   rips the viewport away from whatever the user scrolled up to read. Warp
   auto-follows only while pinned to bottom. Plus a fragile 200ms double
   `scrollIntoView` (`BlockList.tsx:77-83`) that fires regardless of pinning.
2. **O(N²) streaming render** — the active card's `coloredOutput` memo keys on
   the full accumulated `rawOutput`, so every RAF tick re-runs `ansiToHtml`
   over the whole output so far; a long `npm install` re-parses megabytes per
   frame.
3. **Unbounded DOM** — "clamped" cards only get `maxHeight:300px;overflow:
   hidden` (`CommandBlock.tsx:257`): the *full* HTML is still in the DOM, just
   visually clipped. Active cards render everything. 10k-line outputs = 10k+
   nodes per card. Warp bounds what it materializes.
4. **Full-list re-renders** — neither `CommandBlock` nor `BlockList` is
   memoized; every streaming tick re-renders every history card, re-running
   `block.output.split('\n')` (unmemoized, `CommandBlock.tsx:96`) and
   `extractPromptParts` per card. Inline closures (`onToggleCollapse`,
   `onPasswordDone` at `TerminalSession.tsx:1241`) defeat memo.
5. **AI conversation remount** — group key is `items.map(id).join('|')`
   (`BlockList.tsx:209`), so appending a follow-up changes the key and
   remounts the whole `AIConversation` (flicker, lost scroll/animation state).

## Plan

### P0 — card-jank batch (this session, TDD)
- **Pinned-to-bottom auto-scroll**: `src/utils/scrollPolicy.ts`
  (`isPinnedToBottom`), scroll-position tracking in `BlockList`; both scroll
  effects (instant + deferred-grow) gate on pinned. Kills jank #1.
- **Output windowing**: `src/utils/outputWindow.ts` (`headLines`/`tailLines`
  with hidden-count). Finished clamped cards render only the head window
  (expander unchanged); the active streaming card renders only the tail window
  — bounds both per-frame `ansiToHtml` cost (#2) and DOM size (#3). Full
  output stays on the block for copy/AI/expand.
- **Stable conversation key**: key groups by first item id (#5).
- **Memoization pass** (refactor under green): `React.memo(CommandBlock)`,
  memoized line-count, stable per-id toggle callbacks in `BlockList`,
  `useCallback` for `onPasswordDone` (#4).

### P1 — block interaction parity — IMPLEMENTED 2026-06-10 (17ca95d)
Right-click context menu (copy command / output / both, re-run, ask AI);
exit-code tag (`src/utils/exitStatus.ts`, 130/141/signals neutral like Warp);
git-branch chip resolved from post-exec cwd via the cached `git:branch` IPC
(`src/utils/blockMeta.ts` patches immutably); find-in-blocks Ctrl+F overlay
(`src/utils/blockFind.ts`, `BlockFinder.tsx`) with match cycling and a
transient ring on the matched card.

### P2 — session restore — IMPLEMENTED 2026-06-10 (98aab44)
`src/utils/sessionRestore.ts`: last 50 finished blocks per tab, 200-line tail
cap, localStorage (not electron-main SQLite — our payloads are small enough);
restored cards seed `displayItems` flagged `restored` and default collapsed.
AI items and active/pending blocks never persist.

### P3 — render windowing — IMPLEMENTED 2026-06-10 (a93a31d)
Went with `content-visibility: auto` + `contain-intrinsic-size` on finished
history-card wrappers instead of JS virtualization — offscreen cards skip
layout/paint natively, no mount/unmount churn, scroll anchoring intact.

### S — session-card morph — IMPLEMENTED 2026-06-11 (a1eb82a)
Long-running processes root the input into their card (mock-approved design):
`sessionKind.ts` classifier (server/watch/agent/oneshot + 10s promotion,
wrapper-stripping, `detectPort`), new `rooted` input surface (composer hides,
block pins with stdin inside, HTML path, termios outranks), live session
header (dot, kind chip, port chip, ticking elapsed, STOP/END + queued
RESTART via `pendingRestartRef` → re-run on finalize), agent accent for
claude/codex/gemini, un-morph to a collapsed summary card (`sessionSummary`),
crash path (failure exit) stays expanded. Future: agent turn condensation
(parsing TUI output into turns), error-affordance row with suggested fixes.

### Dropped / not transferable
- Cell-grid output model + Alacritty reflow: xterm.js already owns grid/reflow
  for interactive surfaces; cards are read-mostly HTML. Cost ≫ benefit.
- DCS hooks migration: our OSC 133 + OSC 6973 integration covers the same
  lifecycle; no need to switch encodings.
- Multi-block drag selection: native DOM selection across cards already works;
  revisit if users ask for block-anchored selection.
