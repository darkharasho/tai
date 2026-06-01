# Card / Shell-Integration Rearchitecture

**Date:** 2026-06-01
**Status:** Design — awaiting review

## Problem

TAI's terminal cards feel disconnected from their input. Three concrete symptoms:

1. **Output jank.** Bare `\r`, prompt redraws, and partial escape sequences leak into rendered card bodies because segmentation still falls back to regex heuristics in places where the shell-integration signal is missing or ambiguous.
2. **Password prompts are second-class.** When a command (sudo, ssh, gpg, npm publish) puts the TTY into no-echo mode, the user types into the global input bar with no masking and no clear "this goes to that running command" affordance.
3. **Interactive programs share a body with normal output.** vim, htop, less, ssh-with-an-interactive-prompt all render into the same scrolled card body that holds line-oriented output. The result is visual noise during the session and a useless transcript afterward.

We considered fixing this by spawning one PTY per command (each card owns its own shell). Investigation of Warp's open-sourced architecture confirmed the better path: **one PTY, a louder shell, and richer per-block UI states.** Warp ships the most polished block UX in the industry and explicitly does *not* per-PTY. The lesson: segmentation is a signal-quality problem, not a topology problem.

## Goal

Make the card model honest: each card knows exactly when its command started, what's running inside it, and what shape of input (if any) belongs to it right now. No regex guessing for segmentation. Interactive programs get a card UI that fits them. Password prompts get a real password field.

**Non-goals:**

- Per-command PTYs.
- Reimplementing a shell in the orchestrator.
- Replacing the existing OSC 133 integration — this design extends it.
- Windows / PowerShell support in this spec (follow-up).

## Architecture

The terminal session keeps its single PTY and its single real shell. Three layers change:

### 1. Shell integration — louder, structured

Today `tai-bash.sh` emits OSC 133 A/C/D and TAI's segmenter consumes them. Two gaps:

- **A regex prompt-detection fallback still exists** in `BlockSegmenter` (`PROMPT_RE`) for sessions without integration. That fallback is the source of most of the rendering jank for users on remote hosts, fresh shells, or unusual prompt setups. The design *keeps* the fallback but treats integration as the only fully-supported path; the fallback is best-effort and clearly degraded.
- **Metadata that segmentation can't infer** (post-alias-expansion command text, signal-vs-exit, duration, git branch, cwd changes mid-block) currently comes from heuristics or isn't available at all.

**Change:** Add a second marker channel — a private JSON OSC sidechannel modeled on Warp's `OSC 9278`. The shell emits one hex-encoded JSON payload from `precmd` carrying:

```json
{
  "hook": "precmd",
  "exit": 0,
  "signal": null,
  "duration_ms": 142,
  "command": "git status",
  "cwd": "/home/m/code/tai"
}
```

…and one from `preexec` carrying `{"hook":"preexec","command":"…"}`. OSC 7 continues to carry cwd changes mid-block.

The custom OSC is **6973**, terminated with `BEL` (`\007`). Wire format:

```
ESC ] 6973 ; <hex-encoded-json> BEL
```

6973 was chosen because it sits in a documented dead zone — no known assignment in xterm, iTerm2, VTE, kitty, WezTerm, Alacritty, Konsole, Windows Terminal, or VS Code — and is well clear of Warp's 9277/9278. It's prime, which discourages accidental collisions from emulators picking "round" numbers. BEL terminator is chosen over `ST` for safety inside `tmux`/`screen`, where `ESC \` can be mis-parsed. The segmenter must ignore unrecognized OSC 6973 payloads (unknown `hook` values, malformed JSON, non-hex bodies) without breaking block segmentation.

The segmenter's OSC 133 state machine stays canonical for *boundaries*. The JSON sidechannel only *enriches* a block that's already framed by 133 markers. If the sidechannel is missing, blocks still segment correctly — just with less metadata.

Bash, zsh, and fish all get the sidechannel. Three files; the hook surface is small.

### 2. Card body modes — explicit, lifecycle-driven

Today every card body is "rendered line-oriented output." This design gives a block three explicit body modes, chosen by the segmenter based on observed signals:

- **`Output`** — line-oriented stdout/stderr, as today. Default.
- **`Interactive`** — a live xterm.js instance bound to the same PTY, scoped to this block's lifetime. Entered when the PTY enters alt-screen (`\e[?1049h`, `\e[?47h`, `\e[?1047h`) *while a block is active*. Exited when alt-screen leaves; the block then settles to `Output` mode showing whatever non-alt-screen output existed (typically nothing — the program owned the screen).
- **`PasswordPrompt`** — a masked input field rendered as the card's input affordance. Entered when the segmenter observes the PTY entering no-echo (`ICANON & ~ECHO`) *while a block is active*. node-pty exposes termios state; the existing main process needs to forward that signal up to the renderer. Submitting the field writes the password + `\n` to PTY stdin and clears the field. Exits when echo returns or the block ends.

The modes are not mutually exclusive across a block's lifetime — a `git push` to a remote that asks for a passphrase may go `Output` → `PasswordPrompt` → `Output`. The card UI is a small state machine, not a static layout.

### 3. Per-card input — implicit, lifetime-scoped

While a block is active (post-`OSC 133;C`, pre-`OSC 133;D`), the *global* input bar greys out and the *card* grows an inline input that writes to PTY stdin. This is the user's "continue in this card" idea, but implicit: any time a process is in the foreground, its card is the input target. When the block ends, the global input takes over again.

For the common short-lived case (`ls`, `git status`) the card is born and dies before the user notices the input affordance — same feel as today. For long-running interactive cases (`ssh`, `python`, `claude`, `psql`) the card naturally owns its input.

The global bar isn't useless while a block runs — it queues. (TAI already has a queue chip; this is just making the queue semantics first-class.)

## Data flow

```
PTY bytes
  ├─→ xterm.js (always, for headless terminal state)
  └─→ BlockSegmenter (OSC 133 + OSC 9278-equivalent + OSC 7)
        ├─→ block lifecycle events (start, finish, exit code, duration, command)
        ├─→ alt-screen events (entered / exited)  → card mode = Interactive
        ├─→ echo-off events (from main process)   → card mode = PasswordPrompt
        └─→ cwd updates                            → orchestrator state

Card input (typed)
  └─→ if active block: pty.write
      else: global input bar / queue
```

## Components changed

- `electron/shell-integration/tai-bash.sh` — add JSON sidechannel from `preexec`/`precmd`.
- `electron/shell-integration/tai-zsh.zsh` — same.
- `electron/shell-integration/tai-fish.fish` — same.
- `electron/<main process pty bridge>` — surface termios echo state to renderer as IPC events.
- `src/components/BlockSegmenter.ts` — parse the new OSC; emit enriched block metadata; emit echo-off events; emit alt-screen-during-block events.
- `src/components/CommandBlock.tsx` — body-mode state machine; in-card input affordance while active.
- `src/components/TerminalInput.tsx` — greys out / queues while any block is active.
- `src/components/PasswordPrompt.tsx` — already exists; rewire to be card-attached rather than session-modal.
- `src/components/HiddenXterm.tsx` — likely renamed/refactored; each `Interactive`-mode card needs a real xterm view bound to the same buffer.

## Testing

- **Unit:** segmenter parses well-formed OSC 9278 JSON; ignores malformed; degrades when sidechannel is absent.
- **Unit:** block mode transitions on alt-screen enter/exit and echo-on/off events.
- **Integration:** spawn a real bash with `tai-bash.sh` sourced; assert boundary markers + JSON arrive in expected order across: simple command, command with newlines in output, alias-expanded command, signal-killed command, command that enters/exits alt-screen, command that disables echo.
- **Integration:** zsh + fish parity for the above.
- **Manual:** vim, htop, less, ssh into a host with password prompt, sudo, python REPL, `claude` itself.

## Risk and mitigation

- **Termios-echo signal latency.** The renderer needs to know about no-echo within a few hundred ms or the password field arrives after the user has typed half their password into the wrong place. Mitigation: poll termios on every PTY data event in the main process; debounce-emit on change.
- **OSC number collision.** Resolved: OSC 6973 + BEL terminator. Segmenter must ignore unrecognized payloads cleanly so future-Warp or future-emulator additions in nearby ranges don't break us.
- **rc-file injection edge cases.** Users with exotic prompt setups (starship, transient prompts, p10k instant prompt) can break OSC 133 hook ordering. The existing `tai-bash.sh` already deals with this for PS1; the JSON sidechannel must be equally defensive.
- **Visual regression.** Cards changing body mode mid-stream is new behavior — needs a clear transition (no layout jump). Mitigation: card body has a fixed min-height while active.

## Out of scope (follow-ups)

- AI gets first-class structured-block context (the big payoff, but its own spec).
- Windows / PowerShell shell integration.
- Restoring scrollback from an Interactive-mode session into the post-exit transcript (Warp does some of this; non-trivial).
- "Send this to that card" UI — typing in the global bar with an explicit card target. Possible polish, not in this spec.
