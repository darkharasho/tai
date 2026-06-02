# Remote-AI Pill — Design

Date: 2026-06-01
Status: Draft (for review)

## Problem

When a user runs an interactive `ssh` in a TAI tab, that ssh is a **foreground
command block** holding the tab's single PTY (keystrokes pass through to the
remote shell). The bottom composer still shows the **local** identity
(`mstephens@bazzite`) and is disabled ("command running — input queues"). The AI
conversation is anchored at that composer, i.e. **local and outside the ssh
session**. So there is no way to (a) ask Claude about the remote session, or
(b) have Claude act on the remote host, while you're sitting in it.

TAI already has the two halves needed but they aren't connected:

- **Detection:** `BlockSegmenter.onSshSession(active, target)` fires with the
  host the moment an interactive ssh is detected (the recent SSH-detection
  work). Nothing consumes it for AI.
- **Remote execution:** the tai-daemon path in `electron/services/claude.ts`
  routes Claude's tool calls to a host over its *own* SSH connection when
  `isRemoteExec && daemonEnabled`. Today it only arms when the *composer prompt*
  is detected remote (`eff.isRemote` → `setRemoteTarget`), which never happens
  during an interactive ssh.

## Goal

A subtle, opt-in **inline pill** in the composer row that bridges
`onSshSession` → the AI side, offering two modes:

- **Watch** — Claude runs locally but receives the remote session's scrollback
  as context (observability).
- **Run** — Claude's tools execute on the host via the daemon (Route 1: a
  separate SSH connection; per-host helper install accepted).

This supersedes and removes the cryptic `⥂` manual-mark control added earlier;
`src/utils/remoteOverride.ts` is repurposed as the underlying override state the
pill drives.

## Decisions (from brainstorming)

- Intent: **both** observe and execute (user-selectable).
- Execution route: **Route 1** — separate SSH connection / tai-daemon, per-host
  install acceptable. (Route 2, sharing the interactive PTY, rejected.)
- Trigger: **opt-in offer**, shown the moment an interactive ssh is detected.
- Visual: **inline composer pill** (not a card).
- Install step: **pill morphs in place** (`enable → installing → active`), no
  separate surface.
- Active control: **segmented `👁 watch | ▸ run` toggle**, current mode lit
  (teal = watch, amber = run), host label beside it.
- Claude replies carry a small `host` context tag.
- **AI input stays live even while a foreground command (the ssh) runs** — AI is
  out-of-band from the PTY. Shell input still queues; AI input sends
  immediately.

## Pill lifecycle

```
(no ssh)            → no pill
ssh detected        → [ ✦ AI · piclock  enable ]      (amber, dismissable per-host)
click enable
  host has helper   → active (default: watch)
  host needs helper → [ ⟳ installing… ] → active
active              → [ 👁 watch | ▸ run ]  piclock   (+ disconnect via ✕/long-press)
revisit set-up host → active (watch) immediately, no install prompt
```

State lives per tab (and remembered per host for skip-install + last mode).

## Components

### Renderer

- **`src/utils/remoteAiSession.ts`** (new, pure, tested) — the state machine:
  `type RemoteAiMode = 'off' | 'watch' | 'run'`; helpers to derive pill state
  from `{ sshActive, sshTarget, helperInstalled, mode }` and to compute the next
  state on enable/toggle/dismiss/disconnect. Repurposes/absorbs
  `resolveEffectiveRemote` from `remoteOverride.ts`.
- **`TerminalInput.tsx`** — replace the `⥂` control with the pill rendered from
  `remoteAiSession` state. Props: `remoteAi: { mode, target, installing,
  helperInstalled }`, `onEnableRemoteAi()`, `onSetRemoteAiMode(mode)`,
  `onDismissRemoteAi()`. Remove `manualRemote`/`onSetManualRemote` props and the
  `markRemote*` CSS.
- **`TerminalSession.tsx`** — owns the `remoteAiSession` state. Subscribes to
  `segmenter.onSshSession`. On enable: call `daemon.check(target)`; if missing,
  set `installing`, call `shellIntegration`/daemon install, then activate. Wire
  mode → existing `setRemoteTarget(tabId, target, mode === 'run' ? 'auto' :
  'local')` and `setDaemonEnabled`. In **watch**, push the remote session's
  scrollback into the per-turn context (see below). Tag AI replies with the host.
- **Composer-lock change** — `inputDisabled` currently blocks all input while a
  foreground command runs. Change so that **AI-mode** input is *not* disabled
  when remote-AI is active: shell input still queues; AI submit sends. The block
  body / password modes still lock.

### Context (watch mode)

- The remote session scrollback is the ssh foreground block's output. Feed it
  into the AI turn the same way `buildRecentContext` feeds local activity, run
  through `redactSecrets`. Source: the active ssh block's accumulated output in
  `displayItems` / BlockSegmenter. A `host` field marks it remote so the system
  block can say "the user is in an ssh session on `<host>`; recent remote
  output follows."

### Execution (run mode)

- No new transport. `run` ⇒ `remoteExecMode='auto'` + `daemonEnabled` for the
  detected `target`, which the existing `claude.ts` path already turns into
  remote MCP tool routing. `watch` ⇒ `remoteExecMode='local'`.

## Data flow

```
BlockSegmenter.onSshSession(true, "piclock")
  → TerminalSession: remoteAi = { sshActive:true, target:"piclock", mode:'off' }
  → TerminalInput renders OFFER pill
user clicks enable
  → daemon.check("piclock")
      installed   → mode='watch'
      not install → installing=true → install → installed → mode='watch'
  → setRemoteTarget(tab,"piclock", mode==='run'?'auto':'local')
toggle → onSetRemoteAiMode('run')
  → setRemoteTarget(tab,"piclock",'auto'); setDaemonEnabled(tab,true)
ssh exits (onSshSession(false)) → pill clears; mode resets to 'off'
```

## Error handling

- `daemon.check` / install failure → pill shows a brief error state, falls back
  to **watch** (observability still works without the helper). Use
  `detectSshError` for messaging where applicable.
- Host unreachable for watch context → silently degrade to no-remote-context.
- ssh drops mid-session (`onSshSession(false)`) → pill clears, mode → off,
  remote target cleared (already handled by the SSH-session teardown).

## Testing (TDD)

- `tests/unit/remoteAiSession.test.ts` — state machine: off→watch on enable
  (installed), off→installing→watch (not installed), watch↔run toggle,
  dismiss, ssh-exit reset, per-host memory.
- `TerminalInput` — pill renders correct state per mode; toggle/enable/dismiss
  fire callbacks; no pill when no ssh.
- `TerminalSession` — `onSshSession` drives pill; mode maps to
  `setRemoteTarget` exec mode; watch injects redacted remote scrollback into
  context; AI input not disabled while a command runs when remote-AI active.

## Out of scope

- Route 2 (sharing the interactive PTY).
- Non-Claude providers for `run` (codex/gemini MCP differs — watch works for
  all since it's local execution with extra context).
- Multi-hop / jump-host chains.
- Restyling unrelated cards.

## Removed / superseded

- The `⥂` manual-mark control and `markRemote*` styles in `TerminalInput`
  (replaced by the pill). `remoteOverride.ts` logic folds into
  `remoteAiSession.ts`.
