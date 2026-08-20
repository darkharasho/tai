# Warp UI as the Baseline Chrome

Date: 2026-08-19
Branch: `feat/warp-ui-baseline`
Status: P0–P2 approved for implementation; P3–P4 deferred pending review.

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

### P3 — Shell chrome (deferred)

Top bar plus left tab sidebar, retiring the horizontal `TabBar`. Highest risk
of the set: `TabBar.tsx` carries overflow collapsing, inline rename, and the
window controls, all of which must move rather than be rewritten. Also forces
the README screenshots to be retaken.

### P4 — AI block at rest (deferred)

Collapse `InlineAIBlock`'s resting state to Warp's single row.

## Testing

The theming system has no snapshot coverage and the change is visual, so the
gate is: `tsc --noEmit` clean, the existing suite no worse than its baseline
(41 pre-existing failed files from a `require is not defined` breakage in the
jsdom mocking setup, unrelated to this work), and human verification in the
running app against the reference screenshot.
