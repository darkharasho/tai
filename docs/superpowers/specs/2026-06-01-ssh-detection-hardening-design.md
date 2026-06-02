# SSH Detection Hardening — Design

Date: 2026-06-01
Status: Draft (for review)

## Motivation

Warp open-sourced their terminal (`warpdotdev/warp`, AGPLv3). Their SSH-session
detection is materially more robust than TAI's, and porting the two key ideas
fixes real false-positives in TAI today.

## How Warp does it (reference)

Two cooperating signals in `app/src/terminal/ssh/`:

1. **Command parsing** — `util.rs::parse_interactive_ssh_command`
   (runs at pre-exec). Not a whole-line regex:
   - `shell_words::split` the command (proper quote handling); strip a leading
     `command ` builtin prefix; require `tokens[0] == "ssh"` exactly.
   - Walk tokens: **reject `-T` / `-W`** (no-PTY / stdio-forward ⇒
     non-interactive); **skip the argument of option-flags** that take one
     (`-o -i -L -p …`) so an option value is never read as the host; capture
     `-p` as the port.
   - First positional ⇒ host. **A second positional ⇒ return `None`**
     (`ssh host cmd` is a one-shot remote command, not a session).
   - Also recognizes SSH-like wrappers: `gcloud compute ssh`, `eb ssh`,
     `doctl compute ssh`.

2. **Login-state confirmation** — `util.rs::check_ssh_login_state`
   (watches block output). Classifies the last output line into
   `LastLogin` / `Authenticating` / `PromptDetected` / `NonSshOutput` using
   `Last login:`, a prompt-char regex `[$#%>❯│⟫»▶λ→] $`, and auth keywords
   (`password`, `Password`, `passphrase`, `yes/no`, `Please type`, `'yes'`,
   `Confirm user presence`, leading `Enter `/`Allow `). The host comes from the
   **command**; "are we in the remote shell yet" comes from **output** — never
   from the remote prompt containing `user@host`.

Gating: feature flag + per-host denylist + subshell allow/denylist.

## What TAI does today

`src/components/BlockSegmenter.ts`:

- `SSH_CMD_RE = /^ssh\s+(?:.*\s)?(?:(\S+)@)?(\S+)\s*$/` — one greedy regex, used
  at three sites (legacy block close ~L406, OSC 133 `C` branch ~L572, integrated
  block close ~L717).
- `_isRemotePrompt()` (~L429) decides "remote" purely by parsing `user@host` out
  of the **prompt string** (`SSH_TARGET_RE`) and comparing to `_localHostname`.
- `_setSshSession(true, …)` fires **only** from the OSC 133 `C` branch (~L577),
  i.e. it needs *local* shell integration active.

### Concrete defects

1. **`SSH_CMD_RE` misparses common commands** (greedy `(?:.*\s)?`, no
   interactivity check):
   - `ssh host ls` → host = `ls`; under OSC 133, `_setSshSession(true, "ls")`.
   - `ssh -T git@github.com` (git-over-ssh, never a shell) → flagged as a
     session → can pop the "install shell integration" card against GitHub.
   - `ssh user@host 'sudo reboot'` → host = `reboot'`.
2. **Remote detection requires a `user@host` prompt.** A remote host with a
   minimal `PS1` (`$ `, `➜ ~`) is never recognized as remote, so remote-AI-exec
   routing and the integration card silently don't engage — even though the
   target was in the command.
3. **No interactivity/auth gating.** No `-T`/`-W` rejection, no
   "second positional = one-shot" rule, no `Last login:` / prompt-char
   confirmation. Password masking regex `/(?:password|passphrase).*:\s*$/i`
   (~L303, L661) misses `yes/no` TOFU, FIDO `Confirm user presence`, and
   `Enter passphrase for …`.

## Proposed change

New, isolated, unit-tested module `src/utils/sshDetect.ts`:

```ts
export interface InteractiveSshCommand { host: string | null; port: string | null }
// null = not an interactive ssh invocation
export function parseInteractiveSshCommand(command: string): InteractiveSshCommand | null

export type SshLoginState = 'last-login' | 'authenticating' | 'prompt-detected' | 'non-ssh-output'
export function checkSshLoginState(blockOutput: string): SshLoginState
```

- `parseInteractiveSshCommand` ports Warp's `parse_ssh_command`: a small
  `shell_words`-style splitter (handles single/double quotes; bail to `null` on
  malformed quoting), strip `command `, require `ssh` token 0, reject `-T`/`-W`,
  skip option-args, capture `-p`, reject 2nd positional. Optionally recognize
  `gcloud compute ssh` / `eb ssh` / `doctl compute ssh` (return host `null`).
- `checkSshLoginState` ports `check_ssh_login_state`.

### Wiring into BlockSegmenter

- Replace all three `command.match(SSH_CMD_RE)` sites with
  `parseInteractiveSshCommand`. Only set `_sshConnectionTarget` /
  `_setSshSession(true, …)` when it returns non-null (kills the `ssh host cmd`
  and `ssh -T` false-positives immediately).
- Derive "in SSH session / remote target" from **command-parse + login-state**,
  with prompt `user@host` as a secondary confirm — so it works without local
  OSC 133 and without a `user@host` remote prompt. Keep `_isRemotePrompt`'s
  local-hostname guard (it exists to prevent routing *local* sessions through
  ssh+askpass — see the comment at ~L444).
- Widen the password-prompt classifier to Warp's keyword set via
  `checkSshLoginState(...) === 'authenticating'`.

## Risk

This is a sensitive, much-patched path. The `_isRemotePrompt` comment documents
a prior false-positive that routed local sessions through ssh+askpass. Mitigation:
the new module is pure and fully unit-tested; the local-hostname guard stays; we
only *narrow* what counts as an SSH session (fewer false positives), and we add a
new positive signal (login-state) rather than removing the prompt guard.

## Test plan (TDD)

`tests/unit/sshDetect.test.ts`:

- `parseInteractiveSshCommand`:
  - `ssh host` → `{host:'host', port:null}`
  - `ssh user@host` → `{host:'user@host'}`
  - `ssh -p 2222 host` → `{host:'host', port:'2222'}`
  - `ssh -i ~/.ssh/key user@host` → host = `user@host` (option-arg skipped)
  - `ssh -o StrictHostKeyChecking=no host` → host = `host`
  - `ssh host ls` → `null` (2nd positional)
  - `ssh user@host 'sudo reboot'` → `null`
  - `ssh -T git@github.com` → `null`
  - `ssh -W host:port jump` → `null`
  - `command ssh host` → host = `host`
  - `ls`, ``, `sshfoo host`, `ssh` → `null`
  - `gcloud compute ssh vm` → `{host:null}` (if wrappers included)
- `checkSshLoginState`: `Last login:` line, `password:`/`passphrase`/`yes/no`/
  FIDO line, prompt-char last line, plain output → each expected state.

`tests/unit/BlockSegmenter.test.ts`: extend existing SSH cases to assert
`ssh -T git@github.com` and `ssh host ls` no longer fire `onSshSession`/remote.

## Out of scope

Per-host denylist UI, SSH-like wrapper UX, multiplexing/remote-server bootstrap
(Warp's `crates/remote_server`) — TAI's remote story is the separate daemon
feature.
