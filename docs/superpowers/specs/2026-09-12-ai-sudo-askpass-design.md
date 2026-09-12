# AI sudo via TAI askpass — design

Date: 2026-09-12
Status: approved in brainstorming; revised after the feasibility probe (secret now returned over the socket on both platforms)

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
| Cached secret + AI runs sudo | **Auto-fill silently**, same as terminal (after a 150 ms duplicate-claim hold). Show the "sudo authenticated" flash in the AI block. |
| Where the prompt appears when nothing is cached | **Inline in the AI block** that ran the command. Background tab gets a needs-attention marker. |
| Platforms | **Linux and macOS.** Windows is a no-op (see below). |
| Secret delivery | Main process verifies the sudo parent, then returns the secret **over the Unix socket** on both platforms. Each helper pid is answered at most once; any duplicate claim on a pid trips a wire that refuses both, clears the cache and warns the user. |
| Separate `sudo -S -v` validation before caching | **No.** It would spend a `pam_faillock` attempt of its own; sudo's own askpass round trip is the validation. |

### Windows

Windows `sudo` has no askpass mechanism; it always raises a UAC elevation
dialog owned by the OS. TAI sets no askpass variables on Windows and AI sudo
behaves exactly as today.

## Prior art: Otto and SAI

Two sibling apps solve a similar problem
(`otto/src/main/shell/sudo-session.ts`,
`sai/electron/services/sudo/{sudoSession,sudoBroker,sudoHook,index}.ts`):

- A Claude-SDK `PreToolUse` hook detects `sudo` in Bash commands
  (`commandRequiresSudo`, a quote-masking regex) and prompts once.
- The password is validated with `sudo -S -p '' -v`, then written to a `0600`
  file that a stable `SUDO_ASKPASS` helper `cat`s.
- A 60 s keep-alive re-validates and clears the file on failure; when locked,
  the helper exits non-zero so sudo fails fast. No-op on Windows.
- SAI's spec explicitly accepts that the agent can read the password file and
  exfiltrate the password.

Why TAI differs:

1. **Plaintext never reaches the AI.** A readable password file contradicts
   TAI's threat model, so the secret stays in the main process and is only
   released to a verified sudo child.
2. **Provider-agnostic.** The askpass socket works for Claude, Codex and
   Gemini alike; a `PreToolUse` hook is Claude-only.
3. **Prompts on sudo's actual request**, not a regex guess about whether a
   command will need a password.

Not borrowed: the `sudo -S -v` validation step (spends a faillock attempt; see
Decisions) and, as a consequence, the `parseSudoError`-style user messages that
exist to explain its failures.

## Threat model

The AI process can read its own environment, execute `$SUDO_ASKPASS`, read and
modify the generated helper file, connect to TAI's socket, and send signals to
any process running as the same user. It must not be able to obtain the cached
secret.

It is **not** a goal to stop the AI from running root commands once a secret is
cached — auto-fill (decision above) deliberately allows that, gated by TAI's
existing tool approval in Ask mode. The goal is that the **plaintext password
never reaches the AI**, since a password is reusable beyond sudo.

Therefore all trust decisions live in the main process. The helper is
untrusted.

Because the secret is returned over the socket, a client can receive it only
by claiming the pid of a process whose parent is root-privileged `sudo`. Two
broker rules close the accidental and naive cases:

- **Single use per helper pid.** A pid is answered at most once. A spoofer that
  claims a real helper's pid after that helper was answered gets nothing.
- **Duplicate-claim tripwire.** A spoofer must connect before or alongside the
  real helper. Any second claim on a pid that already has a pending or answered
  request refuses **both**, clears the credential vault and shows a warning in
  the AI block. Auto-fill waits `AUTOFILL_HOLD_MS` (150 ms) before answering so
  that a near-simultaneous duplicate trips the wire instead of racing it.

**Residual risk (accepted):** a deliberately malicious agent that races sudo's
helper spawn, `SIGSTOP`s the real helper before it connects (same-uid signals
are allowed), and claims its pid would pass the parent check with no competing
claim and could receive the secret. This requires a targeted attack on TAI,
not accidental behaviour, and is accepted.

## Architecture

### 1. `sudoParent` (main, pure, new) — `electron/services/sudoParent.ts`

`resolveSudoParent(pid): number | null` — the verified sudo pid, or `null`. Fail closed on any uncertainty.

- **Linux:** read `/proc/<pid>/stat` → ppid; read `/proc/<ppid>/status` →
  require `Name:\tsudo` and **any** `Uid:` slot (real, effective, saved, fs)
  `== 0`. A user process cannot hold uid 0 in any slot, and a process that
  does is already root, so faking `Name` gains nothing. Any slot rather than
  only effective, because sudo may temporarily drop its effective uid while
  prompting; the saved uid stays 0 (probe showed `Uid: 1000 0 0 0`).
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
- **Claims:** after the parent check passes, the broker records a claim
  `pid → { sudoPid, requestId, key }`. The claim stays while the request is
  pending and after it is answered; it is released only when the request is
  cancelled or times out without an answer. A claim whose recorded `sudoPid`
  differs from the new request's is treated as a recycled pid and replaced
  (a spoofer claiming a live helper's pid always resolves the same sudo parent).
- **Decision** (pure function, `decideAskpass`), inputs: parent check result,
  `credentialVault.isSet()`, sudo ppid, last auto-filled ppid for that key:
  - parent check fails → `refuse`
  - vault set and ppid ≠ last auto-filled ppid → `auto-fill`
  - vault set and ppid == last auto-filled ppid → `reject` (clear vault, send
    `pty:secret-state false`, then `prompt`)
  - vault empty → `prompt`
- **Duplicate claim** (checked before the decision): refuse the newcomer with
  `{ ok: false }`, cancel the existing request if still pending (reply
  `{ ok: false }`), `credentialVault.clear()`, send `pty:secret-state false`,
  and send `{ type: 'sudo_resolved', requestId, outcome: 'refused-duplicate' }`
  for the original claim's key (and the newcomer's key if different). The
  claim stays burned, so further claims on that pid trip again.
- **Auto-fill hold:** an `auto-fill` decision parks the request for
  `AUTOFILL_HOLD_MS = 150` before replying. A duplicate claim during the hold
  trips the wire and the secret never goes out. When the hold ends the vault
  is re-read; if it was cleared meanwhile, the request falls through to a
  prompt.
- **Delivery:** reply `{ ok: true, secret }` over the socket. Same on Linux
  and macOS.
- **Refuse / cancel / timeout:** reply `{ ok: false }`; helper exits 1.
- **Prompt routing:** `send('ai:message', key, { type: 'sudo_prompt', requestId, prompt })`, reusing the per-tab channel every provider already uses. Resolution and auto-fill use `{ type: 'sudo_resolved', requestId, outcome }` (`outcome`: `'answered' | 'cancelled' | 'refused-duplicate'`) and `{ type: 'sudo_auth' }`.
  Pending requests queue per `key`; one visible (or holding) at a time.
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
  waits for the reply. On `{ ok: true, secret }` prints `secret + '\n'` and
  exits 0; anything else (including `ok: true` without a string secret) exits
  1. EOF / connect failure → exit 1.

With `ELECTRON_RUN_AS_NODE` the helper's pid is the Electron process started by
`exec`, which is still sudo's direct child because `exec` replaces the shell.

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
- `sudo_auth` → existing "sudo authenticated" flash, in the AI block.
- `sudo_resolved` with `outcome: 'refused-duplicate'` → a warning line in the
  AI block (replacing the pending field if one is shown, otherwise appended):
  another process claimed the sudo prompt, it was refused and the cached
  password was cleared.
- `remember: true` → broker calls `credentialVault.set` and sends
  `pty:secret-state true`, so the terminal badge updates too.

## Data flow

Nothing cached:

```
AI tool: sudo apt update  (no tty)
  → sudo execs $SUDO_ASKPASS "[sudo] password for mstephens:"
  → helper → socket {pid, key, prompt}
  → broker: resolveSudoParent(pid) ✓, no prior claim on pid → record claim
  → vault empty → ai:message sudo_prompt
  → AI block shows field → user types, Enter (Remember?)
  → ai:sudo-answer → broker replies {ok:true, secret} over the socket
  → helper prints secret to stdout (sudo's pipe), exits 0 → sudo proceeds
```

Cached: same until the decision, then a 150 ms hold, then the same reply +
`sudo_auth`.

Duplicate claim:

```
  → second socket request claims a pid with a pending/answered claim
  → broker: newcomer {ok:false}; pending original (if any) {ok:false}
  → credentialVault.clear(), pty:secret-state false
  → ai:message sudo_resolved {outcome:'refused-duplicate'} → warning line
```

## Error handling

| Case | Behaviour |
|---|---|
| Parent is not root-owned `sudo` | Refuse; helper exits 1. Secret never touched. |
| Cached secret wrong | Same sudo ppid asks again → clear vault, `pty:secret-state false`, show field. |
| Second claim on a pid with a pending or answered request | Refuse both, clear vault, `pty:secret-state false`, warning line in the AI block. Further claims on that pid keep tripping. |
| Pid recycled for a new helper under a different sudo | Not a duplicate; old claim replaced. |
| User cancels | Helper exits 1; sudo reports no password. Claim released. |
| No answer in 5 min | Cancel as above. |
| AI turn aborted / tab closed | Cancel all pending for that key. |
| Parallel prompts | Queue per key. After any fill of sudo process P (auto-fill or answer), no *different* sudo process is auto-filled (any key) until P has gone `FILL_SETTLE_MS = 3000` without asking again; those requests stay queued (not prompted, not refused) and are re-evaluated when the window ends, one settle window per fill. If P re-asks inside the window, the reject path runs (vault cleared, `pty:secret-state false`, prompt) and the queued ones fall to prompt. So a wrong remembered/cached secret costs one faillock attempt, not one per parallel sudo. |
| TAI quits mid-prompt | Socket closes → helper EOF → exit 1. |
| Broker failed to start | `askpassEnv` returns `{}`; AI sudo behaves as today. |
| Any secret handling | Never logged, never in env, never in transcripts, never in any renderer message; leaves the main process only as the socket reply to a verified, first claim on a helper pid. Renderer holds a typed secret only until Enter. |

## Testing

**Unit (vitest):**
- `sudoParent`: fixture `/proc` and `ps` text — accept root-owned sudo; reject
  user-owned sudo, root non-sudo, missing pid, unreadable/garbled input.
- `decideAskpass`: full matrix (parent ok/fail × vault set/empty × same/different ppid).
- Broker lifecycle with a fake clock: queueing, cancel, timeout, key cleanup,
  secret absent from anything sent to the renderer except `pty:secret-state`
  booleans; auto-fill replies only after `AUTOFILL_HOLD_MS`.
- Broker single-use and tripwire: an answered pid claimed again is refused;
  a duplicate during a shown prompt refuses both, clears the vault, sends
  `pty:secret-state false` and `refused-duplicate`; a duplicate during the
  auto-fill hold refuses both and the secret is never sent (advance past the
  hold); further claims keep tripping; a cancelled request releases its claim;
  a recycled pid under a different sudo is not a duplicate; a cross-key
  duplicate notifies both keys.
- Helper: prints a returned secret and exits 0; exits 1 on refusal, on `ok`
  without a secret, on hang-up, and with no broker.
- `askpassEnv`: set on linux/darwin, empty on win32, empty when broker down;
  terminal PTY env contains neither variable.
- `SudoPrompt`: Enter sends answer and clears, Remember flag, Esc cancels.
- Renderer sudo item reducer: `refused-duplicate` replaces a pending field or
  appends a warning.

**Integration (Linux, real processes, no real sudo):** real broker + real
helper spawned from a non-sudo parent → broker refuses, helper exits 1, vault
untouched (SECURITY). Plus an end-to-end auto-fill through the real socket
with a stubbed parent check. Also run on the macOS CI runner.

**Pre-implementation probe — result (2026-09-12, Fedora/Bazzite, sudo 1.9.17p2,
`yama.ptrace_scope=0`, `fs.suid_dumpable=2`):**
1. **Parent identity — PASS.** The askpass helper's parent shows
   `Name: sudo`, `Uid: 1000 0 0 0`. The parent-check design stands.
2. **Writing into the helper's stdout via `/proc/<askpass pid>/fd/1` — FAIL.**
   Opening it for write as the user gives `EACCES`: sudo's askpass child is
   non-dumpable, so its `/proc` fd entries are root-only. Our generated helper
   is launched the same way, so there is no workaround. **Design changed** to
   returning the secret over the socket on both platforms, with the single-use
   and duplicate-claim hardenings above.
3. **Cancelled askpass as a `faillock` failure — unverified** (not reached).
   Still unknown whether cancelling or a tripwire refusal costs an attempt.

**In-app verification (dev build, CDP):**
1. Nothing cached: ask AI to run `sudo true` → field appears in AI block.
2. Enter with Remember → succeeds; next AI `sudo true` auto-fills with flash;
   terminal badge shows cached.
3. Forget → next AI sudo shows field again; Escape cancels.
4. With a secret cached, have the AI run `"$SUDO_ASKPASS"` directly → gets
   nothing, exit 1; cache stays set (a non-sudo parent is refused before any
   claim, so it does not trip the wire).
5. Background tab shows the attention marker while a field is pending.
6. After a cancelled prompt, check `faillock --user $USER` to record probe
   item 3.

The duplicate-claim tripwire cannot be triggered in-app without deliberately
spoofing a live sudo helper; it is covered by broker unit tests.

**Not verifiable locally:** macOS. Covered by unit tests and the CI refusal
test only.

## Out of scope

- Windows (no askpass mechanism).
- Remote-exec / SSH-routed AI tools.
- Persisting the secret across restarts.
- Changing terminal auto-fill behaviour, including enabling it on macOS.
- Defending against a targeted same-uid attacker that stops the real helper
  (see Threat model).
