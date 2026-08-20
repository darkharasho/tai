# Warp UI as the Baseline Chrome

Date: 2026-08-19
Branch: `feat/warp-ui-baseline`
Status: P0–P4 implemented.

## Problem

TAI already ships a `warp` *palette* (added 2026-08-19, ported verbatim from
`warpdotdev/themes` → `warp_bundled/warp_dark.yaml`). Recolouring is not what
was asked for: the request is for TAI's chrome to *look like Warp* — block
shape, header contract, composer, shell layout — not for one more entry in the
theme dropdown.

The decision taken up front: **Warp becomes the baseline layout for every
theme.** The existing eight themes keep their palettes and inherit the new
shape. `[data-theme="warp"]` stays a palette only. This preserves the
"themes are colour, layout is shared" invariant the theming system was built
around, at the cost of changing how TAI looks on every theme.

## Reference

A Warp screenshot supplied by the user is the acceptance target. What it shows,
against what we render today:

| Surface | Warp | TAI today |
| --- | --- | --- |
| Block header | Two lines — muted meta line (`v24.14.1 ~/Documents/GitHub/sai git:(main) 0 • +0 -0 (0.022s)`) above the command; command bare, no `❯` | One line: user + path + `❯` + command, duration/exit pill right-aligned |
| Failure | 3px red bar down the block's left edge | `exit 1` pill on the right |
| Card | None — background shift and padding only | Rounded card + border on live-widget blocks |
| Chrome | Top bar (icon cluster / centred search pill / icons + window controls) plus a left sidebar of tabs, each row title + `⌥ main` | Horizontal pill tab bar; no sidebar |
| Composer | Chip row (`v24.14.1`, cwd, `main`, `± 0`) → flush input → muted hint line, no box | One rounded bar, `Shift+Tab AI` right-aligned |
| AI block | One resting row: avatar, bold title, `Restored` chip, share + `›` | `InlineAIBlock`, much taller at rest |

## Phases

### P0 — Repoint the `warp` palette (CSS variables only)

The published `warp_dark.yaml` declares `background: #000000`. The screenshot's
chrome is plainly grey, because Warp derives its UI surfaces by lightening the
base rather than painting the window with it. Pure black is therefore wrong for
the *chrome* even though it is the published value.

Resolution: the 16 terminal colours stay verbatim from `warp_dark.yaml`
(they are what the terminal grid is actually painted with, and the earlier
instruction to use Warp's exact values applies to exactly those). The UI
surfaces are retargeted to the screenshot:

- pane `#1c1c1e`, top bar / sidebar `#2b2b2e`, elevated rows `#232326`
- borders `#333338`, text `#e8e8e8` / `#c0c0c0` / muted `#8a8a8a`
- link + accent `#4a9eff` (the saturated blue in the screenshot; note this is
  *not* `warp_dark.yaml`'s `accent: #00c2ff`, which belongs to a different
  Warp theme than the one screenshotted)

### P1 — Block layout, all themes

`CommandBlock`'s non-collapsed header splits into two rows:

- `.metaLine` — muted, 11px mono: shortened cwd, `git:(branch)` when known,
  duration. Block actions and the exit tag ride on this line, right-aligned.
- `.cmdLine` — 13px mono, `--text-primary`, the command alone. No `❯`, no
  user@host prefix for local blocks.

`.block` drops the accent gradient wash and the always-on inset rail. Flat
background, generous padding, separation by whitespace. The rail returns only
to carry state: `--color-error` on failure, the accent while running.

Deliberately **not** in scope: `data-card-accent` and `.blockCard`. That chrome
is reserved for blocks hosting live widgets (xterm, password prompt, REPL), not
the ordinary command blocks the screenshot shows, so the setting keeps working
untouched. This is a narrowing from the design as first presented.

Also **not** invented: Warp's meta line carries a language version and
`+0 -0` diff counts that TAI does not collect. Only fields we actually have are
rendered; no placeholders.

`.promptPath` currently hardcodes `#3b82f6` instead of reading a variable —
fixed here as a side effect, since the meta line must be muted and
theme-driven.

### P2 — Composer

`TerminalInput`'s single rounded `.box` becomes Warp's stack:

1. a chip row — cwd, git branch, and TAI's existing permission/remote badges
   recast as chips
2. the input, flush, no frame, long muted placeholder
3. a hint line beneath, more muted still, carrying the `Shift+Tab` affordance

The AI/shell mode signal moves from the right-hand edge into the chip row so
the input line itself stays clean.

### P3 — Shell chrome

`TabBar` is retired and split in two:

- `TopBar` — the drag region and the window's icon chrome: sidebar toggle and
  new-tab on the left, a centred search pill, settings plus the non-mac window
  controls on the right. The pill is a button, not a field: it opens the
  existing command palette, which is already where TAI searches history,
  commands and workflows. Giving it its own text input would have grown a
  second search surface competing with the palette and `BlockFinder`.
- `TabSidebar` — a vertical rail: index, title (ssh target when remote), the
  cwd leaf beneath it, working dot, trust badge on the active row, close on
  hover. Inline rename moves over unchanged (double-click, Enter/Escape).

The old bar's width measuring, hidden measure container and overflow dropdown
have **no counterpart** and are deleted rather than moved: a vertical list
scrolls, so tabs no longer compete for horizontal space. This is the one place
the plan said "move, don't rewrite" and the answer turned out to be "delete".

The sidebar's visibility persists as `appearance.sidebar` (default on). No new
keybinding: `Ctrl+B` and the obvious neighbours are readline bindings the shell
owns, so the toggle is a button only.

Still outstanding: the README screenshots show the old horizontal tab bar and
need retaking.

### P3.1 — Refinement pass

Review of the running app against the reference turned up four fit-and-finish
gaps and two bugs the new chrome exposed:

- **Epoch durations.** The legacy segmenter path timed a block from
  `_startTime`, which is `0` until the first prompt lands — so a MOTD banner
  reported `29786422m 36s`. No start time now means no duration. (The
  OSC-133 path already guarded this.)
- **Empty cards.** Before the first prompt there is no prompt to strip a
  command off of, so control bytes and zero-width characters landed in
  `command`, survived the trim, and rendered as a bare prompt row. Both
  command and output must now contain a printable character.
- **Collapsed rows.** P1 restyled only the expanded header, but restored
  blocks render collapsed — so most of what a returning user sees was still
  the old chrome. The collapsed row is now a one-line version of the new
  header: no status glyph, no `❯`, no exit pill; command left, cwd and
  duration muted on the right, failure on the same left rail the expanded
  block uses. Exposed as `data-collapsed` / `data-exit` so tests can assert
  the contract without matching on hashed class names.
- **Block rhythm.** Warp separates blocks with whitespace instead of borders,
  so the padding has to carry the separation: `8px 16px 10px` → `12px 16px 14px`.
- **Composer.** `Shift+Tab` was advertised twice, in the placeholder and in
  the hint line beneath it. The hint line keeps it.
- **Drag region lost.** `.cluster` carried both `flex: 1 0 auto` and
  `-webkit-app-region: no-drag`, so the two clusters stretched across the
  whole bar and left the window undraggable. `no-drag` moved onto the
  controls themselves.
- **Top bar centring.** `.window-frame::before` paints a 2px animated strip
  over the top edge without displacing anything, so bar contents centred
  against a band partly hidden beneath it. The strip's height is now
  published as `--frame-inset` and the bar pads by it.

### P3.2 — The AI exchange

An AI exchange carried four accent systems at once — the conversation's
gradient rail, an elevated `YOU` bubble with its own left border, a bordered
rounded card, and two masked corner accents — sitting directly beside command
blocks P1 had already flattened to a single rail.

The question now renders like a command line: bare mono text, no bubble and no
label, with a `↳` glyph the only marking on a follow-up. The answer renders
like output: no card, no border, no corner accents, and an 11px muted meta line
carrying the provider swatch, name and duration. State rides the left rail —
transparent at rest, accent while streaming.

Two consequences worth recording:

- Remote exchanges lost the orange `border-left` the bubble carried, so the
  signal moves to `--accent-color` on the turn; the provider swatch and the
  streaming dot both read it and follow automatically.
- `data-card-surface` comes off the turn. It is no longer a card, so the
  `data-card-accent` setting must stop decorating it — dropping the CSS alone
  would have left stripes and glow painting a flat surface. `data-ai-turn` and
  `data-streaming` replace it as the asserted contract.

Three single-meta-line variants were mocked in-app and the bare-question one
chosen. An earlier draft put a second meta line (`ask · claude`) above the
question, which read as two headers per exchange.

### P4 — AI block at rest

Warp's screenshot shows a *restored* AI conversation folded to one row. TAI
does not restore AI turns — only command blocks survive a session — so there is
no equivalent state to collapse by default, and folding finished turns
automatically would hide answers the user just asked for. P4 therefore ships
the affordance without the default: a finished turn's meta line doubles as the
collapse control, folding the answer down to that single row.

The folded row is the meta line plus a summary: the first real line of the
reply, markdown markers stripped, truncated rather than wrapped. A streaming
turn offers no chevron, since the row would have to summarise an answer still
arriving. Exposed as `data-collapsed` / `data-ai-meta`, mirroring the collapsed
command row's contract.

Collapse state is local to the component rather than lifted into `BlockList`'s
`manualCollapsed` set: AI turns are not windowed and not restored, so nothing
outside the turn needs to read or persist it.

## Testing

The theming system has no snapshot coverage and the change is visual, so the
gate is: `tsc --noEmit` clean, the existing suite green, and human
verification in the running app against the reference screenshot.

(An earlier draft of this section claimed 41 pre-existing failed files. That
was an artifact of running `vitest` without `--config tests/vitest.config.ts`.
Under the project config the suite is 126 files / 928 tests, fully green, and
there is no pre-existing breakage to discount against.)
