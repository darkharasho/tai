# Airtight zsh integration (ZDOTDIR) + bash echo suppression — Design

**Date:** 2026-06-19
**Status:** Approved (user delegated final call) → pending implementation plan
**Follow-up to:** the shell-history-scrub work (v1.10.1). Goal: load the zsh
integration as part of shell startup (never typed, never in history/up-arrow,
no on-screen echo, no idle-timing heuristic), and hide bash's residual on-screen
echo of its typed bootstrap.

## Background

TAI loads its shell integration (`electron/shell-integration/tai-{bash.sh,zsh.zsh,fish.fish}`)
by **typing a `source` command into the live PTY** after the prompt goes idle
(`pty.ts:188-214`). v1.10.1 made that history-clean (leading space + guarded
bash self-scrub + zsh `HISTORY_IGNORE`). Two warts remain:

1. **zsh in-memory up-arrow:** zsh can't cleanly remove an already-executed
   command from the current session's history, so a zsh user without
   `HIST_IGNORE_SPACE` still sees the one bootstrap line this session.
2. **on-screen echo:** the typed `. '/…/tai-bash.sh'` line briefly flashes when
   a tab opens (both shells).

zsh has a clean fix the others lack: **`ZDOTDIR`** redirects *all* zsh startup
files, so the integration can load during startup — invisible, never typed.
bash has no equivalent for **login** shells (`--rcfile` is ignored for login
shells, and TAI deliberately spawns `$SHELL --login` at `pty.ts:133` for the
full login environment), so emulating login in a custom rcfile is fragile
(double-sourcing `~/.bashrc`). We therefore keep bash on its current safe path
and only suppress its echo in the renderer.

## Scope

- **zsh:** load via a `ZDOTDIR` shim; stop typing `source` for zsh; no idle wait.
- **bash:** unchanged launch (login + typed injection, already history-clean);
  suppress the bootstrap echo line in the renderer.
- **fish:** unchanged (leading space already keeps it out of history; its echo
  is left as-is — out of scope).

## Constraints (hard)

- **Must not break a user's zsh environment.** All of the user's real startup
  files (`.zshenv`, `.zprofile`, `.zshrc`, `.zlogin`) must run exactly once, in
  the correct order, for a login interactive shell.
- Preserve a user's pre-existing `$ZDOTDIR` (capture and restore; restore to
  *unset* if it was unset).
- Restore `ZDOTDIR` for child/subshell zsh so nested shells use normal config.
- The integration itself (`tai-zsh.zsh`) is unchanged — only *how* it's loaded.
- **zsh cannot be integration-tested on the dev machine (not installed).** TS
  env logic is unit-tested; the shim is static-reviewed; **real-zsh in-app
  verification is a release gate.**

## Architecture

### zsh — `ZDOTDIR` shim (modeled on VS Code / iTerm2)

Ship a static shim directory `electron/shell-integration/zsh-shim/` containing
four files: `.zshenv`, `.zprofile`, `.zshrc`, `.zlogin`. When `$SHELL` is zsh,
`pty.ts` sets these env vars on the spawn (and **skips the typed injection** for
zsh):

- `ZDOTDIR` → the shim dir (so zsh reads our four files).
- `TAI_ZDOTDIR_USER` → the user's original `$ZDOTDIR` if set, else `$HOME`.
- `TAI_ZDOTDIR_WAS_SET` → `1` if the user had `$ZDOTDIR` set, else empty.
- `TAI_ZSH_SHIM` → the shim dir path (so shim files can re-assert it).
- `TAI_ZSH_INTEGRATION` → absolute path to `tai-zsh.zsh`.

**Shim file behavior** (the load-bearing correctness):

zsh reads, for a login interactive shell, in order: `.zshenv` → `.zprofile` →
`.zshrc` → `.zlogin`, each from the *current* `$ZDOTDIR`. The shim keeps
`ZDOTDIR` pointed at itself through the first three files (re-asserting it after
sourcing each user file, in case a user file changes it), sources the user's
corresponding real file from `$TAI_ZDOTDIR_USER`, and the `.zshrc` additionally
sources the integration and then **restores** `ZDOTDIR`:

- `.zshenv`: `[ -f "$TAI_ZDOTDIR_USER/.zshenv" ] && source "$TAI_ZDOTDIR_USER/.zshenv"; ZDOTDIR="$TAI_ZSH_SHIM"`
- `.zprofile`: source user `.zprofile`; `ZDOTDIR="$TAI_ZSH_SHIM"`
- `.zshrc`: source user `.zshrc`; `source "$TAI_ZSH_INTEGRATION"`; **restore ZDOTDIR**
  (`export ZDOTDIR="$TAI_ZDOTDIR_USER"`, or `unset ZDOTDIR` if `TAI_ZDOTDIR_WAS_SET`
  is empty).
- `.zlogin`: safety net — source user `.zlogin`; restore ZDOTDIR. (In the normal
  login flow `.zshrc` already restored `ZDOTDIR`, so zsh reads `.zlogin` from the
  *user* dir and this shim `.zlogin` is not read; it exists only to cover an
  unusual flow where `.zshrc` was skipped.)

Each shim file guards on file existence (`[ -f ... ]`) and is a no-op when the
user has no corresponding file. After `.zshrc` restores `ZDOTDIR`, the user's
real `.zlogin` (if any) runs once from the user dir.

**Why this ordering is safe:** all four user files run exactly once; the
integration loads after the user's `.zshrc` (so the user's `PROMPT_COMMAND`/
`precmd` setup is in place first — `tai-zsh.zsh` already layers onto existing
hooks); `ZDOTDIR` is restored before any child shell or the user's `.zlogin`.

### bash — renderer-side echo suppression

bash's launch and typed injection are unchanged. The `BlockSegmenter` already
suppresses prompt-only / empty noise blocks; add a narrow filter that drops the
echoed bootstrap line — a line whose command is exactly a `.`/`source` of our
integration script (matches `^\s*(\.|source)\s+'?\S*tai-bash\.sh'?\s*$` and the
remote `shell-integration.sh` variant). This is the same shape used by the bash
history scrub guard, so it can't over-match a real command. The line appears in
the pre-first-prompt output (the source runs before OSC 133 markers exist), so
the filter applies to that early raw output.

## Components

- `electron/shell-integration/zsh-shim/{.zshenv,.zprofile,.zshrc,.zlogin}` — new
  static shim files.
- `electron/services/pty.ts` — new: detect zsh → set the ZDOTDIR env vars + skip
  typed injection; extract a pure `buildZshShimEnv(baseEnv, shimDir, integrationPath)`
  helper for unit testing. The existing `buildIntegrationSourceCommand` path
  stays for bash/fish.
- `src/components/BlockSegmenter.ts` (or a pure helper it calls) — new:
  `isBootstrapEchoLine(command): boolean` + wiring to drop it.
- Packaging: ensure `zsh-shim/` (dotfiles included) is copied via electron-builder
  `extraResources` alongside the other shell-integration assets.

## Error handling / edge cases

- User has no `.zshrc`/`.zprofile`/etc. → shim `[ -f ]` guards make each a no-op.
- User already set `$ZDOTDIR` → captured into `TAI_ZDOTDIR_USER`, restored at the
  end; their files are sourced from their dir.
- User sets `ZDOTDIR` *inside* their `.zshenv`/`.zshrc` → we re-assert the shim
  between files so our files still load; final restore goes to the original
  captured value (matches VS Code; a dynamically-self-relocating ZDOTDIR is an
  accepted edge).
- Non-zsh shells → untouched.
- Shim files must ship with dotfile names; verify electron-builder includes
  dotfiles in `extraResources` (globs sometimes skip `.*`).

## Testing

- **Unit (TS):** `buildZshShimEnv` sets `ZDOTDIR`/`TAI_*` correctly; preserves vs
  unsets per `WAS_SET`; zsh path skips the typed injection while bash/fish still
  build the source command. `isBootstrapEchoLine` matches the bootstrap echo and
  spares real commands (`cat tai-bash.sh`, etc.).
- **BlockSegmenter:** feeding the bootstrap echo line drops it; a normal command
  is unaffected.
- **Static review:** the four shim files walked against zsh startup-file order.
- **Real-zsh in-app (release gate, needs a zsh box):** open a zsh tab → no echo,
  nothing in up-arrow/`history`, the user's prompt/theme intact, blocks segment
  correctly (OSC 133/6973 working), `echo $ZDOTDIR` shows the user's value (or
  unset), and a nested `zsh` subshell starts normally.

## Out of scope

- bash `--rcfile` login-emulation (rejected: fragile double-source risk).
- fish echo suppression.
- Removing the 600 ms idle-injection heuristic for bash/fish (only zsh stops
  using it).
