# Terminal Authority Migration — Design

**Date:** 2026-08-19
**Status:** Approved design, pending implementation plan
**Branch:** `terminal-authority-migration`

## Problem

TAI's terminal pipeline has recurring edge cases that are expensive to fix and
tend to regress: raw-mode/TUI handoffs (A), prompt and command-echo
reconstruction (C), and SSH/remote state (D). Each fix has been a targeted
patch, and each patch has tended to move the failure somewhere else.

The root cause is structural, not incidental: **the same fact is decided by
multiple independent deciders with different latencies, and the loser of that
race silently corrupts or discards data.**

### The three competing authorities

"Is a raw-mode / TUI program running?" is currently answered three times:

| Source | Latency | Writes |
|---|---|---|
| `TUI_REPOSITION_RE` regex — `src/components/BlockSegmenter.ts:697` | instant | `_inAltScreen` |
| Alt-screen escape scan — `_feedIntegrated` | instant | `_inAltScreen` |
| termios `interactiveProgram` over IPC — `src/components/TerminalSession.tsx:691` | 200ms poll + 500ms debounce | `interactiveMode` |

The results land in three separate React flags (`altScreenVisible`,
`interactiveMode`, `interactiveFullscreen`) whose precedence is resolved ad hoc
in `src/utils/inputSurface.ts`. The authoritative signal (termios, straight from
the kernel line discipline via `electron/services/termiosPoller.ts:83`) is up to
**700ms behind** the two inferred signals. A disagreement window therefore exists
on every TUI launch.

### Why the race is destructive rather than merely wrong

`_routeChunk` (`BlockSegmenter.ts:632`) returns early whenever `_inAltScreen` is
set, discarding the chunk. That is correct for a genuine alt-screen program —
xterm.js renders it and the line emulator would only produce garbage — but the
regex at line 697 sets the same flag. **A false TUI inference destroys output
irrecoverably.**

`_inAltScreen` also conflates two distinct facts:

- the program has taken over the alt screen (fullscreen takeover), and
- the program owns line editing (docked REPL).

Fixing a symptom of one repeatedly breaks the other.

### The reconstruction problem (C), and its hidden D consequence

`_finalizeIntegratedBlock` derives the block's `command` from
`_osc133RawCommand` — the *echoed bytes* captured between the OSC 133 B and C
markers — passed through `renderTermText` (`BlockSegmenter.ts:728`) to undo the
shell's redraws.

But the shell already tells us the command verbatim. `parseOsc6973` populates
`_pendingPreexec` (line 483, currently never read) and `_pendingPrecmd`
(line 484). The verbatim string is even attached to the block already — as the
secondary field `commandFromShell` (line 773) — while every consumer reads the
reconstructed `command`.

This directly manufactures D bugs. At the end of finalize:

```ts
const ssh = parseInteractiveSshCommand(command);
```

SSH detection parses the *reconstructed* text. An `ssh` invocation that
reconstructs imperfectly (wrapped line, autosuggestion ghost, theme redraw)
yields a wrong host or no session at all. `sshDetect.ts` is correct; it is being
fed a corrupted input.

### Silent degradation

When authoritative signals are unavailable, heuristics take over and nothing
records that this happened. Three cases:

- **No shell integration** — partly tracked (`_integrationActive`,
  `hooksAvailable`).
- **Remote SSH** — untracked. Local termios reflects the `ssh` process, not the
  remote shell; no remote OSC 133 or 6973.
- **Windows / ConPTY** — no termios, no `/proc`. Handled by a hardcoded special
  case in `inputSurface.ts` (`isWindows && commandRunning → docked`).

The same command behaving differently with no visible reason is a large part of
why these bugs are hard to triage.

## Non-goals

- **Collapsing the dual `TermEmulator` / xterm.js model.** Deferred to its own
  spec. A meaningful share of the pain attributed to "two emulators" is
  suspected to be mode flapping between them; that should be re-assessed after
  this work lands.
- **Pushing shell integration to remote hosts ("Warpify").** Deferred; see
  "Future work". This design makes it a drop-in when picked up.
- **Any change to the shell integration scripts.** Every hook required is
  already emitted by `electron/shell-integration/tai-{zsh.zsh,bash.sh,fish.fish}`.

## Architecture

A new pure module, `src/utils/terminalMode.ts`, is inserted *below* the existing
surface resolver:

```
raw signals ──▶ terminalMode.resolve() ──▶ InteractiveSignals ──▶ deriveInputSurface() ──▶ surface
                        │
                        └──▶ ModeState (also read by BlockSegmenter)
```

`src/utils/inputSurface.ts` is already the correct shape — a pure
`deriveInputSurface(signals) → surface` with a documented precedence ladder. It
keeps its signature and its tests. The defect is one layer up, where its inputs
are produced by competing deciders.

### Signals in

```ts
type ModeSignal =
  | { kind: 'termios';    icanon: boolean; echo: boolean }   // authoritative
  | { kind: 'altScreen';  entered: boolean }                 // authoritative
  | { kind: 'tuiHint' }                                      // inferred
  | { kind: 'osc133';     phase: 'prompt' | 'command' | 'output' | 'idle' }
  | { kind: 'hook';       hook: ShellHook }                  // preexec / precmd
  | { kind: 'ptyExit' }
```

`ShellHook` is the existing type from `src/types/shellHooks.ts`.

### State out

```ts
interface ModeState {
  inputOwner: 'shell' | 'program' | 'fullscreen';
  provenance: 'authoritative' | 'inferred' | 'degraded';
  degradedReason?: 'no-hooks' | 'no-termios';
  passwordPrompt: boolean;
  commandRunning: boolean;
}
```

`provenance` is the load-bearing addition: downstream behaviour branches on *how
we know*, not only on *what we know*.

`provenance` describes the basis of the **current** decision, and the three
values are ordered, not orthogonal:

- `'authoritative'` — this decision came from termios or an alt-screen escape.
- `'inferred'` — this decision came from `tuiHint`, with an authoritative source
  available but not yet heard from.
- `'degraded'` — no authoritative source is available for this context at all.

`degradedReason` records *which* authoritative source is missing, and the two are
independent: on Windows (`'no-termios'`) alt-screen escapes are still received,
so an alt-screen decision there is `'authoritative'` while a raw-mode decision is
`'degraded'`. Degradation is per-source, never global.

The retention rule in "Retention decoupled from rendering" keys off this
directly: bytes are dropped only under `'authoritative'`, so `'degraded'`
inherits the retaining behaviour of `'inferred'` without a separate rule.

### Resolution rules

1. **Tiered authority.** `termios` and `altScreen` are authoritative and always
   win.
2. **`tuiHint` may only promote.** It can move `shell → program`, never demote,
   and never override an authoritative signal already received for the current
   command. The regex is demoted, not deleted: Ink-style TUIs (including Claude
   Code) never enter the alt screen, and termios is 700ms behind, so the fast
   path has real value — just not the authority to be wrong destructively.
3. **Two facts, two values.** Alt-screen takeover resolves to
   `inputOwner: 'fullscreen'`; raw-mode line-editing ownership resolves to
   `'program'`. They are no longer the same flag.
4. **A command boundary resets inference.** `precmd` / OSC 133 D returns
   `inputOwner` to `'shell'`; the foreground is the shell again by definition.

### Consumers

- `TerminalSession` replaces `altScreenVisible` / `interactiveMode` /
  `interactiveFullscreen` with a single `modeState`. The 500ms debounce at
  `TerminalSession.tsx:691` is removed — it exists to paper over the race the
  resolver now settles — but that removal is a rule change and therefore lands
  in the *second* commit of rollout step 3, not the behaviour-neutral first one.
- `BlockSegmenter` deletes `_inAltScreen` and the `onAltScreen` /
  `onInteractiveMode` callbacks. It *emits* `ModeSignal`s and *reads*
  `ModeState` for routing decisions.
- `deriveInputSurface` keeps its signature. Its `isWindows` / `commandRunning`
  special case is deleted and re-derived from `provenance === 'degraded'`.

## BlockSegmenter changes

### Command text from hooks

When hooks are available, the block's `command` **is** the hook value
(`preexec.command`, corroborated by `precmd.command`). The
`renderTermText(_osc133RawCommand)` reconstruction becomes the fallback for
non-integrated shells only.

This removes, rather than patches, the C symptom class: doubled echo, PS2
artifacts, p10k/starship redraw garbage, autosuggestion ghosts. It also fixes
the SSH-target parsing described above with no change to `sshDetect.ts`.

`commandFromShell` remains on the block for compatibility, now equal to
`command` whenever hooks are present.

### Retention decoupled from rendering

`_routeChunk`'s drop becomes provenance-gated:

- `provenance: 'authoritative'` → drop as today. Safe and intentional.
- `provenance: 'inferred'` → **retain to a bounded side buffer** (256KB cap,
  same shape as `MAX_OSC_PAYLOAD`). Rendering still routes to xterm, so
  behaviour is unchanged when the hint is correct.

If an authoritative signal later contradicts the hint, the retained bytes are
replayed into `_outEmu` and the block recovers its output. The 700ms window
becomes self-healing instead of lossy. The buffer is discarded once an
authoritative signal confirms the flip.

**Invariant: mode decides rendering, never retention.** A wrong flip costs an
ugly card, never lost data.

## Degraded mode

**Degraded is observed, never assumed.** The resolver does not ask "are we on
Windows?" or "are we in SSH?". It asks whether an authoritative signal has been
received for the current foreground context.

Consequences:

- Three special cases collapse into one code path.
- It self-heals: if a remote host emits OSC 133 (integration installed there, or
  another tool emits it), hooks arrive and degraded clears itself.
- Remote integration push ("Warpify") becomes a drop-in later — hooks appear,
  the session promotes on its own, with no resolver changes.

| Case | Today | After |
|---|---|---|
| No shell integration | partly tracked | `degraded: 'no-hooks'` |
| Remote SSH | untracked | `degraded: 'no-hooks'` |
| Windows / ConPTY | hardcoded in `inputSurface.ts` | `degraded: 'no-termios'` |

### Behaviour when degraded

1. **Retention is unconditional.** No signal is authoritative, so nothing is safe
   to drop; the side buffer is always on.
2. **Classify from command shape, not from bytes.** Use
   `parseInteractiveSshCommand` and `sessionKind` — knowable before execution
   and testable. This is what distinguishes `ssh host ls` (normal block) from
   `ssh host` (live surface).
3. **Under-segment rather than mis-segment.** A speculative prompt match does not
   split a block. A merged block is a cosmetic annoyance; output attributed to
   the wrong command is a lie that propagates into AI context, re-run, and
   session restore. This is a deliberate, user-visible behaviour change: some
   remote sessions will produce fewer, larger blocks than today.
4. **Surface it.** A quiet chip on the block or tab ("limited shell
   integration"), reusing the existing `ShellIntegrationInstallCard`
   (`src/components/ShellIntegrationInstallCard.tsx`) affordance, which already
   fires for SSH targets that stay silent on OSC 133. Note: the `⥂` manual
   remote override (`src/utils/remoteOverride.ts`) referenced in earlier drafts
   was removed in `c379e3b` as superseded by the remote-AI pill; there is no
   manual override to point at.

## PTY record and replay

### Ring buffer

An in-memory ring buffer per pty (~1MB, always on), plus a **"Save PTY
recording"** action. Capture happens *after* the anomaly is noticed, which is
the only ergonomics that works for bugs nobody sees coming. Disk writing for
long captures stays opt-in behind a debug setting.

### Format

JSONL, one entry per pty read or out-of-band event:

```jsonl
{"t":0,    "kind":"data",   "d":"<base64>"}
{"t":214,  "kind":"termios","icanon":false,"echo":true}
{"t":631,  "kind":"data",   "d":"<base64>"}
{"t":1180, "kind":"exit",   "code":0}
```

`t` is milliseconds from session start.

Two requirements drive this format:

- **Chunk boundaries must be preserved.** `_altScreenTail = rawData.slice(-7)`
  exists solely because escape sequences split across chunks; a replay that
  re-chunks does not reproduce those bugs.
- **Out-of-band events must be interleaved.** After this design, mode resolution
  depends on termios transitions arriving over IPC. A recording without them
  cannot replay the decision.

Base64 because pty output is not guaranteed valid UTF-8 — the reason
`src/utils/sanitizeSurrogates.ts` exists.

### Replay harness

`tests/helpers/replayPty.ts` reads a fixture, drives a fresh `BlockSegmenter`
and `terminalMode` resolver with the original chunking, and returns:

- resulting blocks (command / output / exitCode / isRemote), and
- the **mode transition timeline**
  (e.g. `shell → program(inferred) → program(authoritative) → shell`).

The timeline is what catches flapping regressions; a block snapshot cannot show
them.

### Seed corpus

`claude` (Ink TUI, no alt screen), `vite` (raw-mode flip on shortcuts), `python`
REPL, `htop` (true alt screen), `ssh host` (interactive), `ssh host ls`
(one-shot), p10k/starship prompt redraw, `sudo` password prompt.

### Privacy

- The ring buffer is **memory-only** until the user explicitly saves. Nothing
  touches disk implicitly.
- Saved recordings go to app data, local only, never auto-uploaded, with a plain
  warning at save time.
- `src/utils/redactSecrets.ts` runs on **export/share**, not on capture —
  redacting raw bytes would corrupt escape sequences and destroy the fidelity
  that makes the recording useful.
- Fixtures committed to the repo get a scrub pass (paths, hostnames, usernames).

A saved recording is a plaintext, secret-bearing file on disk by design. This is
accepted for an explicit user action with a clear warning, consistent with
`script(1)` and asciinema.

## Testing

1. **Resolver unit tests** — `terminalMode` is a pure reducer; precedence
   becomes a table of signal sequences in, `ModeState` timelines out. Every rule
   in "Resolution rules" is pinned here.
2. **Segmenter unit tests** — command-from-hook precedence; retention recovery
   (inject an inferred flip, contradict it with termios, assert retained bytes
   land in the block's output).
3. **Replay tests** over the fixture corpus.
4. **Existing suite stays green** — 115 unit test files. The four direct
   tripwires are `BlockSegmenter.test.ts`, `blockSegmenterHooks.test.ts`,
   `blockSegmenterOscCap.test.ts`, `blockSegmenterSshReset.test.ts`.

Run with `--maxWorkers=2` per the global test-runner limit.

## Rollout

Steps are sequenced so each ships independently and every regression is
attributable.

**Step 1 — harness first, no behaviour changes.** Build recorder, replay helper,
and capture all eight fixtures against *current* code. Several snapshots will
encode today's wrong behaviour; commit them as explicitly-labelled known-bad
expectations. Without this baseline the later steps cannot distinguish a fix
from a regression on exactly the bugs that resist manual reproduction.

**Step 2 — command from `preexec`/`precmd`.** Smallest diff, largest immediate
win. Flips known-bad snapshots for C and for SSH-target parsing.

**Step 3 — resolver, in two commits.** First move the logic with no rule
changes; the resolver must reproduce today's decisions exactly, verified by
identical replay timelines. Only then change the tier rules. Collapsing these
two commits would make step 4's regressions unattributable.

**Step 4 — provenance-gated retention.** Ends the silent data loss.

**Step 5 — degraded mode**, including the under-segmentation change — the most
user-visible item, landing last.

No feature flag: steps are small enough that `git revert` is the rollback, and a
flag in this layer would become another source of divergent behaviour.

### Manual verification

The corpus cannot cover focus, keystroke echo, or scroll feel. Before release,
in zsh+p10k, bash, and fish: `claude`, `vite`, `python`, `htop`, an interactive
`ssh`, and `sudo`.

This project changes no shell integration scripts, so the hard real-zsh
verification gate from the ZDOTDIR work does not re-trigger.

### Risk

Step 3's rule changes are the risky part: they alter timing-sensitive behaviour
that currently has ad-hoc compensation scattered around it (the 500ms debounce,
various stale-state clears). Some of that compensation becomes redundant and
some becomes actively wrong, and the corpus cannot replay focus or input. Expect
one or two follow-up fixes after real use; the corpus makes them cheap to pin
down.

## Future work

- **Warpify remote hosts** — push the integration script over SSH so remote
  sessions get authoritative hooks. Own spec, including the security
  conversation about writing to remote machines. Requires no resolver changes.
- **Collapse the dual emulator model** — re-assess after this lands.
