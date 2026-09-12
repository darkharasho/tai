# AI sudo via TAI askpass — design

Date: 2026-09-12
Status: approved in brainstorming, pending spec review

## Problem

TAI's in-app sudo password widget and `CredentialVault` cache
(`docs/superpowers/specs/2026-06-20-sudo-credential-caching-design.md`) only
cover `sudo` typed into a terminal PTY. That design listed `SUDO_ASKPASS`
integration as out of scope.

When the AI runs `sudo` through its tool (Claude's Bash tool, Codex, Gemini),
the command has no controlling tty. `sudo` then falls back to `$SUDO_ASKPASS`,
which KDE sets to `/usr/bin/ksshaskpass`, so the user gets an external
"Enter SSH Credentials" dialog that knows nothing about TAI's cached password.

Verified on the running v1.20.1 AppImage: TAI's Claude process
(`--resume 77ff3c7c…`) ran `sudo parted`, `sudo dd`, `sudo mkfs.exfat` with no
tty; the terminal shell (`bash`, `pts/5`) has one.

## Goal

AI-initiated `sudo` uses TAI's own password widget, inside the AI block that
ran the command, and shares the same session-scoped cache as the terminal.

## Decisions

| Question | Decision |
|---|---|
| Cached secret + AI runs sudo | **Auto-fill silently**, same as terminal. Show the "sudo authenticated" flash in the AI block. |
| Where the prompt appears when nothing is cached | **Inline in the AI block** that ran the command. Background tab gets a needs-attention marker. |
| Platforms | **Linux and macOS.** Windows is a no-op (see below). |
| Secret delivery | **Approach 1**: main process verifies the sudo parent and, on Linux, writes the secret directly into the helper's stdout pipe. |

### Windows

Windows `sudo` has no askpass mechanism; it always raises a UAC elevation
dialog owned by the OS. TAI sets no askpass variables on Windows and AI sudo
behaves exactly as today.

## Threat model

The AI process can read its own environment, execute `$SUDO_ASKPASS`, read and
modify the generated helper file, and connect to TAI's socket. It must not be
able to obtain the cached secret.

It is **not** a goal to stop the AI from running root commands once a secret is
cached — auto-fill (decision above) deliberately allows that, gated by TAI's
existing tool approval in Ask mode. The goal is that the **plaintext password
never reaches the AI**, since a password is reusable beyond sudo.

Therefore all trust decisions live in the main process. The helper is
untrusted.

## Architecture

### 1. `sudoParent` (main, pure, new) — `electron/services/sudoParent.ts`

`resolveSudoParent(pid): number | null` — the verified sudo pid, or `null`. Fail closed on any uncertainty.

- **Linux:** read `/proc/<pid>/stat` → ppid; read `/proc/<ppid>/status` →
  require `Name:\tsudo` and **any** `Uid:` slot (real, effective, saved, fs)
  `== 0`. A user process cannot hold uid 0 in any slot, and a process that
  does is already root, so faking `Name` gains nothing. Any slot rather than
  only effective, because sudo may temporarily drop its effective uid while
  prompting; the saved uid stays 0.
  `/proc/<ppid>/exe` is deliberately **not** used: sudo is setuid and
  non-dumpable, so `readlink` on it returns `EACCES` for the user.
- **macOS:** `ps -o ucomm=,ruid=,uid=,svuid= -p <ppid>` (and
  `ps -o ppid= -p <pid>`), same test. Parsing is a separate pure function over the `ps` text.

### 2. `askpassBroker` (main, new) — `electron/services/askpassBroker.ts`

A local socket server started at app ready on Linux/macOS only.

- **Endpoint:** Unix socket inside a directory created `0700` under
  `app.getPath('temp')` (e.g. `tai-askpass-<random>/broker.sock`). Removed on
  quit.
- **Request:** one newline-delimited JSON line `{ pid, key, prompt }` where
  `prompt` is the text sudo passed to askpass as `argv[1]`.
- **Decision** (pure function, `decideAskpass`), inputs: parent check result,
  `credentialVault.isSet()`, sudo ppid, last auto-filled ppid for that key:
  - parent check fails → `refuse`
  - vault set and ppid ≠ last auto-filled ppid → `auto-fill`
  - vault set and ppid == last auto-filled ppid → `reject` (clear vault, send
    `pty:secret-state false`, then `prompt`)
  - vault empty → `prompt`
- **Delivery of the secret:**
  - **Linux:** open `/proc/<pid>/fd/1` for writing and write `secret + '\n'`,
    then reply `{ ok: true }` over the socket. The secret never crosses the
    socket, so a client that lies about `pid` only causes the secret to be
    written into the real helper's pipe, which only sudo reads.
  - **macOS:** no `/proc`; reply `{ ok: true, secret }` over the socket.
    **Known weaker guarantee:** a client that races a real sudo prompt and
    claims the real helper's pid could receive the secret. Documented, accepted.
- **Refuse / cancel / timeout:** reply `{ ok: false }`; helper exits 1.
- **Prompt routing:** `send('ai:message', key, { type: 'sudo_prompt', requestId, prompt })`, reusing the per-tab channel every provider already uses. Resolution and auto-fill use `{ type: 'sudo_resolved', requestId, outcome }` and `{ type: 'sudo_auth' }`.
  Pending requests queue per `key`; one visible at a time.
- **Timeout:** 5 minutes (sudo's default `passwd_timeout`), then cancel.
- **Cancellation hooks:** AI turn aborted or tab/session closed for `key` →
  cancel all pending for that key. App quit → close server; helpers get EOF.
- **Last auto-filled ppid** is tracked per key, mirroring `lastFilledTpgid` in
  `pty.ts`, so a wrong cached secret is replayed at most once per sudo process.
  This matters: Fedora's `pam_faillock` locks the account after 3 failures, and
  sudo invokes askpass once per attempt.

### 3. Helper (generated) — `electron/services/askpassHelper.ts`

Two files written `0700` into the broker's directory at startup:

- `askpass` — POSIX sh, the value of `SUDO_ASKPASS` (sudo takes a bare path,
  no arguments):
  ```sh
  #!/bin/sh
  ELECTRON_RUN_AS_NODE=1 exec "<process.execPath>" "<dir>/askpass.cjs" "$@"
  ```
  Uses TAI's own Electron binary as Node, so it does not depend on `node`
  being on the user's PATH (which the packaged app cannot assume).
- `askpass.cjs` — connects to the socket, sends
  `{ pid: process.pid, key: process.env.TAI_ASKPASS_KEY, prompt: argv[2] }`,
  waits for the reply. On `{ ok: true, secret }` (macOS) prints it; on
  `{ ok: true }` (Linux) prints nothing (the broker already wrote to fd 1) and
  exits 0; otherwise exits 1. EOF / connect failure → exit 1.

Note for the Linux path: with `ELECTRON_RUN_AS_NODE` the helper's pid is the
Electron process started by `exec`, which is still sudo's direct child
because `exec` replaces the shell.

### 4. Environment injection

`askpassEnv(key): Record<string,string>` returns
`{ SUDO_ASKPASS, TAI_ASKPASS_KEY }` on Linux/macOS when the broker is running,
`{}` otherwise. Merged at the three AI spawn sites — the local `enrichedEnv()`
wrappers in `claude.ts`, `codex.ts`, `gemini.ts` — **not** in the shared
`platform.enrichEnv()`, so the terminal PTY environment is unaffected.

`key` is the existing per-tab session key those services already use for
routing `ai:*` messages.

Remote-exec (AI tools routed over SSH to another host) is out of scope: sudo
there runs on the remote host and cannot reach a local socket.

### 5. `CredentialVault`

Unchanged. One app-wide secret shared by terminal auto-fill and AI askpass.

### 6. Renderer

- `SudoPrompt` rendered inside the AI block for the matching `key`. Reuses the
  `PasswordPrompt` field UI and "Remember for this session" toggle, extracted
  into a shared presentational component so the terminal and AI variants differ
  only in what Enter does:
  - terminal: writes keystrokes to the PTY (unchanged behaviour)
  - AI: `ai:sudo-answer { requestId, secret, remember }`; Esc / Ctrl+C →
    `ai:sudo-cancel { requestId }`
- Needs-attention marker on the tab's sidebar entry while a prompt is pending
  for a non-active tab.
- `ai:sudo-auth { key }` → existing "sudo authenticated" flash, in the AI block.
- `remember: true` → broker calls `credentialVault.set` and sends
  `pty:secret-state true`, so the terminal badge updates too.

## Data flow

Nothing cached:

```
AI tool: sudo apt update  (no tty)
  → sudo execs $SUDO_ASKPASS "[sudo] password for mstephens:"
  → helper → socket {pid, key, prompt}
  → broker: isSudoParent(pid) ✓, vault empty → ai:sudo-prompt
  → AI block shows field → user types, Enter (Remember?)
  → ai:sudo-answer → broker writes secret to /proc/<pid>/fd/1 → {ok:true}
  → helper exits 0 → sudo proceeds
```

Cached: same until the decision, then immediate write + `ai:sudo-auth`.

## Error handling

| Case | Behaviour |
|---|---|
| Parent is not root-owned `sudo` | Refuse; helper exits 1. Secret never touched. |
| Cached secret wrong | Same sudo ppid asks again → clear vault, `pty:secret-state false`, show field. |
| User cancels | Helper exits 1; sudo reports no password. |
| No answer in 5 min | Cancel as above. |
| AI turn aborted / tab closed | Cancel all pending for that key. |
| Parallel prompts | Queue per key; if the first answer sets Remember, the rest auto-fill. |
| TAI quits mid-prompt | Socket closes → helper EOF → exit 1. |
| Broker failed to start | `askpassEnv` returns `{}`; AI sudo behaves as today. |
| Any secret handling | Never logged, never in env, never in transcripts; renderer holds it only until Enter. |

## Testing

**Unit (vitest):**
- `sudoParent`: fixture `/proc` and `ps` text — accept root-owned sudo; reject
  user-owned sudo, root non-sudo, missing pid, unreadable/garbled input.
- `decideAskpass`: full matrix (parent ok/fail × vault set/empty × same/different ppid).
- Broker lifecycle with fake socket + fake clock: queueing, cancel, timeout,
  key cleanup, secret absent from anything logged or sent to the renderer
  except `pty:secret-state` booleans.
- `askpassEnv`: set on linux/darwin, empty on win32, empty when broker down;
  terminal PTY env contains neither variable.
- `SudoPrompt`: Enter sends answer and clears, Remember flag, Esc cancels.

**Integration (Linux, real processes, no real sudo):** real broker + real
helper spawned from a non-sudo parent → broker refuses, helper exits 1.
Also run on the macOS CI runner.

**Pre-implementation probe (throwaway, user present, one real sudo prompt):**
1. `/proc/<askpass pid>/fd/1` is writable by the user and the write reaches sudo.
2. `/proc/<sudo pid>/status` is readable and shows `Name: sudo` with uid 0 in some slot.
3. Whether a cancelled askpass (exit 1, no output) counts as a `faillock` failure.
If (1) or (2) fails, stop and revisit Approach 1 before building.

**In-app verification (dev build, CDP):**
1. Nothing cached: ask AI to run `sudo true` → field appears in AI block.
2. Enter with Remember → succeeds; next AI `sudo true` auto-fills with flash;
   terminal badge shows cached.
3. Forget → next AI sudo shows field again.
4. With a secret cached, have the AI run `"$SUDO_ASKPASS"` directly → gets
   nothing, exit 1.

**Not verifiable locally:** the macOS secret-delivery path. Covered by unit
tests and the CI refusal test only.

## Out of scope

- Windows (no askpass mechanism).
- Remote-exec / SSH-routed AI tools.
- Persisting the secret across restarts.
- Changing terminal auto-fill behaviour, including enabling it on macOS.
