# Input-Rooted Interactive Shell ("grow out of the input") — Design

Date: 2026-06-02
Status: Draft (for review)

## Problem

TAI today has **two input surfaces** that the user has to mentally switch
between:

1. The persistent **bottom composer** (`TerminalInput`) — shell/AI mode, ghost
   text, tab-completion, history, the remote-AI pill, the permission badge.
2. A **per-block input grafted onto an active card** whenever a command needs
   live input. There are actually three of these today, in `CommandBlock.tsx`:
   - `interactiveInput` — line-at-a-time for `awaitingInput` reads.
   - `PasswordPrompt` — masked input for sudo/ssh password prompts.
   - `CardInput` — REPL stdin for the `replActive` case.
   - …plus a portaled **xterm** for raw-mode programs and full TUIs.

The result: when you run `python` or `ssh`, your typing focus jumps from the
bottom composer up into a little box stuck to a card. It reads as two separate
tools bolted together rather than one continuous shell.

## Goal

Collapse the two surfaces into one. The **bottom composer becomes the live edge
of the block it spawns** — Warp-style. When you launch an interactive program,
the input visually *docks into* the new block as its live prompt and the block
grows upward out of it; when the program exits, the input *drops back out* to a
free composer below the history stack.

## Guiding principle

> **The bottom input is always the foreground process's stdin.** Who is
> listening decides how it renders and behaves.

This single rule replaces the current ad-hoc set of per-block inputs. The input
has exactly **two personalities**, switched by one signal TAI already computes —
"is the foreground process my shell, or a child program?" (derived from the
termios/echo poll: `onEchoChange` → `e.interactiveProgram`, plus the
`awaitingInput`/`passwordPrompt` signals and `onSshSession`).

### Personality 1 — Shell-prompt composer (foreground = the shell)

The input is a **free composer** below the history stack, exactly as today.
Full TAI smarts: ghost text, AI mode (Shift+Tab), shell tab-completion, history
(↑/↓), remote-AI pill, permission badge. Finished command blocks pile above it;
the composer stays empty and ready.

### Personality 2 — Live-terminal edge (foreground = an interactive program)

The input **docks into the active block** as its live bottom edge. Keystrokes
pass through to the program's PTY (raw passthrough). TAI's composer smarts step
aside — the program owns line editing, so you get its **own** readline: native
tab-completion (python's, the remote shell's), Ctrl-R reverse search, arrow-key
editing, true echo. The block grows upward out of the input. On program exit
(Ctrl-D / `quit`), the input drops back to Personality 1.

## Decisions (from brainstorming)

- **Layout:** Warp-style — the live input is **pinned to the bottom of the
  viewport**; the active block's output grows *upward above it*. (Not in-scroll.)
- **Scope of "grow out":** **Tiers 1 & 2 only.**
  - Tier 1 (line prompts: y/N, password) — block grows; a light single-answer
    line-input sits on the block.
  - Tier 2 (REPLs / ssh: python, node, psql, interactive ssh) — input docks as
    the live edge with **real terminal passthrough**.
  - Tier 3 (full TUIs: vim, htop, less, top) — **full takeover on their own
    surface**, i.e. today's fullscreen/alt-screen xterm. Not docked. Boundary =
    "needs raw keystrokes AND owns the whole screen."
- **Live-input behavior:** **real terminal passthrough** for Tier 2 (reuse the
  existing xterm engine, re-anchored to grow from the bottom). The light
  line-sender survives only for the Tier-1 single-answer case, which never
  needed readline.
- **AI mid-session:** **suspended**, *except* for **ssh sessions**, where the
  existing watch/run remote-AI pill stays available out-of-band exactly as
  today. Local REPLs: exit to the shell prompt to ask AI.
- **Quick (non-interactive) commands:** no docking — the finished block appears
  above and the composer stays free. Falls out of the principle automatically
  (foreground returns to the shell immediately).
- **Completion:** the live block detaches upward into history (collapsible,
  shows duration), and a fresh free composer returns.

## Current architecture (what we're building on)

- `TerminalSession.tsx` owns the PTY wiring, the `displayItems` list, all the
  interactive-state signals (`awaitingInput`, `passwordPrompt`,
  `interactiveMode`, `interactiveFullscreen`, `altScreenVisible`,
  `sshSessionActive`), and renders `BlockList` + a single bottom `TerminalInput`.
- A **single hidden xterm** (`HiddenXterm`) is the real terminal engine. It is
  imperatively relocated (portaled) into the active card's `interactiveBody`
  via `interactivePortalTarget` when `showXterm` is true, and moved back to a
  hidden fallback host otherwise. This preserves xterm buffer/render state
  across the transition.
- `showXterm = altScreenVisible || showFullscreenInteractive || interactiveMode`.
  So **Tier 2 raw-mode REPLs already route through the xterm** (interactiveMode
  is set from `e.interactiveProgram`), as do Tier 3 TUIs.
- `CommandBlock` decides its body via `bodyMode` (`output | interactive |
  password`) and the `replActive` / `isActive` flags, and renders the grafted
  inputs described above.
- The bottom `TerminalInput` is disabled (`inputDisabled`) while a foreground
  command is active (except when remote-AI is active, which keeps it live for
  out-of-band AI).

**Key insight:** the engine to render a live Tier-2 session already exists and
already lives *inside the card* via the portal. This redesign is largely a
**re-anchoring and focus/layout change**, not a new terminal implementation.

## Target architecture

### 1. The pinned live region

Introduce the notion of an **active live block pinned to the bottom** of the
session viewport. When the foreground is a Tier-2 program:

- The active `CommandBlock` is rendered in a bottom-pinned container (sticky /
  flex-end), not in the normal scroll flow with the others.
- History blocks scroll *behind/above* it.
- The xterm continues to portal into this block's `interactiveBody`; the block's
  bottom edge **is** the live prompt line (the xterm's cursor row), so the
  "input" the user types into is the xterm itself — this is what makes
  passthrough/readline authentic.
- The block grows upward as output arrives, up to a **max height**
  (proposal: `min(70vh, content)`); beyond that the block's body scrolls
  internally while the prompt line stays pinned at the block's bottom and the
  block stays pinned at the viewport bottom.

When the foreground returns to the shell, the block un-pins and joins the
normal history flow (Personality 1 resumes; bottom `TerminalInput` re-appears
as the free composer).

This generalizes the existing `replActive` "grow to 60vh" behavior and the
existing portal relocation; the new part is **pinning the active interactive
block to the viewport bottom and treating its prompt row as the composer**.

### 2. Focus & keyboard ownership

- Personality 1: focus lives in `TerminalInput` (today's behavior).
- Personality 2: focus lives in the **xterm** inside the pinned block. The
  bottom `TerminalInput` is hidden (not just disabled) while docked, so there's
  visually one input. The session-level keyboard handler must **not** intercept
  keys that belong to the program — today it already bails when
  `altScreenRef.current || interactiveModeRef.current` (see the `keydown`
  effect); we extend the same guard to the docked state. Ctrl-C / Ctrl-D / Tab /
  Ctrl-R all flow to the PTY naturally.
- Transition: when `interactiveProgram` flips true → move focus into xterm;
  when it flips false → restore focus to `TerminalInput`.

### 3. Tier 1 (line prompts / password)

Largely **unchanged** in mechanism — these don't need readline. Keep
`PasswordPrompt` and the single-answer line-input, but render them as the live
bottom edge of the (pinned) active block so they share the docked visual
treatment. `bodyMode='password'` and the `awaitingInput` line-input stay; they
just live in the pinned container.

### 4. Tier 3 (full TUIs)

**Unchanged behavior** — `showFullscreenInteractive` keeps the full takeover.
The only consistency tweak: ensure the entry/exit visually reads as "grew from
the input then took over" rather than an abrupt swap (optional polish; see
Animation).

### 5. AI coexistence

- Local Tier-2 session → AI suspended. The AI hotkey/Shift+Tab does nothing
  special while docked (keys go to the program). To ask AI, exit the program.
- ssh Tier-2 session → **no change from today**: `onSshSession` drives the
  remote-AI pill (watch/run), AI runs out-of-band against the session
  scrollback. The pill remains visible/usable even though the bottom composer
  is hidden — it anchors to the active block header instead of the composer row
  while docked. (The pill's state machine in `remoteAiSession.ts` is untouched.)

### 6. Completion / detach

When the foreground program exits, the existing `onBlock` / segmenter flow
finalizes the block. The pinned active block un-pins and settles into history.
The bottom composer returns. Add a brief **detach animation** (block lifts and
the fresh composer fades in) — polish, not required for correctness.

## Component-level changes (anticipated)

- `TerminalSession.tsx`
  - New derived state: `docked = interactiveMode && !interactiveFullscreen &&
    !altScreenVisible` (Tier-2 live) — i.e. "input is the live edge."
  - Render the active interactive block in a **bottom-pinned container**;
    render history above it; hide the standalone `TerminalInput` while `docked`.
  - Extend the focus effects to move focus into the xterm on dock and back to
    the composer on undock.
  - Keep the portal relocation, but the portal target is now the **pinned**
    active block.
- `CommandBlock.tsx`
  - A `docked` rendering variant: prompt row + growing body + xterm host as the
    bottom edge; max-height + internal scroll.
  - The remote-AI pill anchors here (in the header) while docked.
- `TerminalInput.tsx`
  - No functional change to Personality 1. It is simply hidden while `docked`.
- CSS modules (`CommandBlock.module.css`, `TerminalSession`)
  - Bottom-pinned layout, grow-upward, internal scroll, dock/undock transitions.

No changes anticipated to `BlockSegmenter`, the PTY layer, `remoteAiSession.ts`,
or the AI request pipeline — this is a **renderer layout + focus** redesign over
signals that already exist.

## Edge cases

- **Nested interactivity** (e.g. `python` → `subprocess` that flips screens, or
  ssh → vim): driven by the same `interactiveProgram` / `altScreen` signals; a
  Tier-3 program launched inside a docked Tier-2 session promotes to fullscreen
  takeover, then returns to docked on exit. Must verify focus restores to the
  right surface.
- **Output while docked but idle** (e.g. `tail -f`): block keeps growing /
  internal-scrolls; prompt row may be absent (program not reading stdin) — the
  bottom edge is just the live output tail. Ctrl-C still flows through.
- **Resize**: xterm fit must track the pinned block's max-height; reuse
  `onResized` → `segmenter.onResize`.
- **Tab visibility / switching tabs** mid-session: pinned block state is
  per-session already (per `TerminalSession`); ensure the portal/host handoff
  survives `visible` toggling.
- **Multi-line shell commands** (Personality 1): unchanged (`isMultilineCommand`
  path stays).
- **Stop button**: the existing per-block STOP (sends `\x03`) stays on the
  docked block header.

## Testing

- Unit: the `docked` derivation from the interactive signals; focus-target
  selection on dock/undock transitions.
- Component: `CommandBlock` docked variant renders the xterm host as the bottom
  edge and applies max-height/internal-scroll past threshold.
- Manual / e2e (the real proof):
  - `python` → type with tab-completion, Ctrl-R, arrows → exit → composer
    returns. Block detaches with duration.
  - `ssh host` → docked; remote-AI pill works (watch/run); exit returns.
  - `sudo` password prompt → docked line-input, masked.
  - `vim` → full takeover, then exit → back to composer.
  - Quick `ls` / `git status` → no docking; composer stays free.
  - `tail -f` → grows/internal-scrolls; Ctrl-C exits.

## Out of scope

- Tier-3 TUIs growing out of the input (rejected — they take over).
- A full AI composer surface during local (non-ssh) live sessions.
- Reimplementing readline inside the React composer.
- Any change to AI routing, the daemon, or the segmenter.

## Open questions for review

- Max-height for the pinned live block — is `70vh` right, or should the live
  block be allowed to fill the viewport (with history fully scrolled away)?
- Dock/undock animation: required for v1 or polish-later?
