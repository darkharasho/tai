# Sudo Credential Caching ("auth sudo once") — Design

Date: 2026-06-20
Status: Approved design, pending spec review → implementation plan

## Problem

TAI surfaces a password widget on every `sudo` command. The widget is
faithful — it appears whenever `sudo` itself re-asks. Because `sudo`'s
credential cache is short-lived and per-tty by default, users hit the prompt
repeatedly. We want a TAI-managed, opt-in credential cache so the user
authenticates **once per app run** and subsequent `sudo` prompts are filled
automatically and safely.

## Prior art: how Warp does it (and why we go further)

Warp's sudo handling is functionally identical to TAI's *current* behavior:
detect echo-off, render a secure input field, forward keystrokes to the PTY.
Warp **does not cache** the sudo password — an integrated password
manager / auto-fill feature was requested
([warpdotdev/Warp#4684](https://github.com/warpdotdev/Warp/issues/4684)) and
**closed as "not planned."** Warp users are pointed at OS-level workarounds
(extended sudo timeout, `sudo -v` pre-auth).

Two findings from Warp's issue tracker shaped this design:

1. **Detection fragility.** Warp's prompt detection breaks on customized or
   localized sudo prompts
   ([#3396](https://github.com/warpdotdev/Warp/issues/3396)), because it leans
   on matching prompt *text*. We avoid this entirely: we gate on termios
   echo-off **plus foreground-process == `sudo`** resolved from `/proc`, never
   on prompt text.
2. **Leak risk.** A cached sudo password landing in a *non-sudo* echo-off
   prompt (ssh, gpg, `mysql -p`, `read -s`) is the obvious danger and the
   likely reason Warp declined caching. The foreground-process gate is the
   direct mitigation.

We deliberately go one step beyond Warp, with the safety gate that addresses
their probable objection.

## Decisions (locked)

- **Lifetime:** app-run only, in-memory. Cleared on app quit, window lock, and
  manual "Forget sudo password". No timed expiry, no disk persistence.
- **Scope:** one cached secret shared app-wide across all tabs/terminals.
- **Trigger:** opt-in. A "Remember for this session" toggle on the password
  widget, **off by default**. Nothing is cached unless the user opts in.
- **Safety gate:** auto-fill only when the PTY's foreground process is `sudo`.
- **Failure handling:** if `sudo` rejects an auto-filled secret, invalidate the
  cache and fall back to the widget.
- **Platforms:** Linux only (relies on `/proc`). macOS foreground-proc lookup
  is a follow-up; Windows is unaffected (no termios path). Where unsupported,
  behavior is exactly as today.

## Approach chosen

**Termios auto-replay.** Reuse TAI's existing detection layer rather than
fighting the shell. Rejected alternatives:

- **`SUDO_ASKPASS` + transparent `sudo -A` wrapper** — requires per-shell
  aliasing (bash/zsh/fish), breaks for bare `sudo` in scripts, and `-A` changes
  behavior subtly. More moving parts for the same result.
- **Sudoers-assist** (auto-write `timestamp_type=global`) — that is the
  separate OS-level workaround, not the in-app feature requested.

## Architecture & components

The plaintext secret lives **only in the main process**. The renderer sends a
boolean "remember" intent and the characters that already flow to the PTY
today; it never receives the stored value back.

1. **`CredentialVault`** (new, main process) — single-slot in-memory store.
   API: `set(secret: Buffer)`, `get(): Buffer | null`, `clear()`,
   `isSet(): boolean`. `clear()` zero-fills the buffer before releasing. No
   disk I/O. The stored value is never exposed over IPC.

2. **Foreground-process resolver** (new, main process) — given the PTY shell
   pid, determine whether the tty's foreground process is `sudo`. Pure `/proc`:
   read `/proc/<shellPid>/stat`, take field `tpgid` (the controlling
   terminal's foreground process-group id), then read `/proc/<tpgid>/comm` and
   compare to `sudo`. No native binding required. Returns
   `'sudo' | 'other' | 'unknown'`. Robust to localized/custom prompt text.

3. **`TermiosPoller` / pty.ts auto-fill decision** (extended) — on a detected
   password prompt (`!echo && icanon`), resolve the foreground process. If
   `foreground === 'sudo'` **and** `vault.isSet()`: write `secret + '\n'`
   directly to the PTY and emit a lightweight `pty:auto-auth` event instead of
   `passwordPrompt: true`. Otherwise emit `passwordPrompt: true` as today.

4. **`PasswordPrompt.tsx`** (extended) — add an opt-in "Remember for this
   session" checkbox (default off). When checked, accumulate the typed
   characters and, on submit, hand them to the vault via a dedicated IPC
   (`pty:remember-secret`); the `\n` still goes to the PTY. When unchecked,
   behavior is exactly as today (keystrokes stream to the PTY; nothing stored).

5. **Failure detection** (main process) — if another `foreground === 'sudo'`
   password prompt fires within a short window (default 2000 ms) after an
   auto-fill, treat it as a rejection: `vault.clear()` and show the widget.

6. **Clear triggers** — app `before-quit`, window lock/lock-blur, manual
   "Forget sudo password" command/menu item, and auth-rejection.

7. **Status indicator** — a subtle persistent indicator whenever a secret is
   cached (so it is never silently held), plus a transient "🔓 authenticated"
   line in the block on auto-fill instead of an input surface.

## Data flow

**First sudo, nothing cached:**
1. `sudo …` → echo off, foreground = `sudo`, vault empty → emit
   `passwordPrompt: true`.
2. Widget shows with unchecked "Remember for this session". User types
   (chars stream to PTY as today).
3. On Enter: if "Remember" checked, renderer sends accumulated chars via
   `pty:remember-secret` → `vault.set(buffer)`; `\n` goes to the PTY. If
   unchecked, identical to today.

**Subsequent sudo, cached:**
1. `sudo …` → echo off, foreground = `sudo`, `vault.isSet()` → main writes
   `secret\n` to the PTY, emits `pty:auto-auth`.
2. Block shows a transient "🔓 authenticated" line; no keystrokes needed.

**Non-sudo echo-off prompt (ssh / gpg / mysql / `read -s`):**
1. foreground ≠ `sudo` → never auto-filled → widget shows as today. The cached
   sudo secret is never written to it.

## Security model

- Plaintext exists only as a `Buffer` in the main process. Never sent to the
  renderer, never logged, never written to disk. `clear()` zero-fills.
- Auto-fill is gated on foreground-process == `sudo`, so the secret can only
  ever be written into a sudo prompt.
- Opt-in only, default off; visible indicator while a secret is held.
- Cleared on quit, window lock, manual forget, and auth rejection.
- Fail safe: any uncertainty in foreground resolution (`unknown`) is treated as
  not-sudo and falls back to the widget — never fail open.

## Error handling & edge cases

- **Wrong password / sudo rejects:** second sudo prompt within 2000 ms of an
  auto-fill ⇒ `vault.clear()` + widget. Prevents lockout loops and repeated
  bad auto-fills against a 3-strikes lockout.
- **Foreground resolution fails** (race between detection and `/proc` read,
  permissions): return `unknown` → fall back to widget.
- **`sudo -k` / sudo's own timeout mid-session:** harmless — next prompt
  auto-fills again from the still-valid cache.
- **Non-Linux / no `/proc`:** feature disabled; widget behaves as today.
- **Windows:** unaffected (no termios poller path).
- **Custom/localized sudo prompt:** unaffected — detection is termios + `/proc`,
  not prompt text.

## Testing

- **Unit:** `CredentialVault` (set/get/clear, zeroing, single-slot semantics).
  Foreground-proc resolver against fixture `/proc` reads (sudo / other /
  unresolvable). Auto-fill decision matrix (cached × foreground × …). Failure
  -window invalidation logic.
- **Integration** (main-process, mockable PTY + termios reader + `/proc`
  reader): first-prompt-remember → second-prompt-autofill → rejection-
  invalidates. Non-sudo prompt never auto-fills.
- **Manual smoke** (existing real-shell gate): real `sudo` in bash/zsh/fish;
  an `ssh`/`gpg` prompt to confirm no leak; window-lock and quit clear the
  cache.

## Out of scope (YAGNI)

- Timed expiry of the cache.
- OS-keychain / cross-restart persistence.
- macOS / Windows foreground-process detection.
- Caching non-sudo secrets (ssh, gpg, db passwords).
- `SUDO_ASKPASS` integration and shell aliasing.

## Key files

- `electron/services/termiosPoller.ts` — detection; add foreground resolution
  hook.
- `electron/services/pty.ts` — auto-fill decision, `pty:remember-secret` /
  `pty:auto-auth` IPC, vault wiring, clear triggers.
- `electron/services/credentialVault.ts` — new.
- `electron/services/foregroundProcess.ts` — new (`/proc` resolver).
- `src/components/PasswordPrompt.tsx` — "Remember for this session" toggle.
- `src/components/TerminalSession.tsx` — auto-auth indicator, state wiring.
- `electron/preload.ts` — IPC bridge for the new channels.
