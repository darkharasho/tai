# Remote AI Execution over SSH

**Date:** 2026-04-13
**Status:** Approved

## Problem

When a user is SSH'd into a remote host, the AI assistant still executes all commands locally. The user expects the AI to operate on the remote host they're connected to.

## Design

### Architecture Overview

When a tab detects an active SSH session (via the existing `isRemote` / `sshTarget` detection in BlockSegmenter), the AI's tool execution is transparently rerouted through a parallel SSH connection to the same remote host. The Claude CLI subprocess remains the AI brain — we intercept its tool calls at the approval boundary and execute them remotely instead of locally.

```
User SSH session (pty)          AI execution path
┌─────────────────────┐         ┌──────────────────────┐
│ user@remote:~$      │         │ Claude CLI subprocess │
│ (interactive shell)  │         │ (local process)       │
└─────────────────────┘         └──────────┬───────────┘
                                           │ approval_needed
                                           ▼
                                ┌──────────────────────┐
                                │ Remote Tool Proxy     │
                                │ (intercept + route)   │
                                └──────────┬───────────┘
                                           │ execute via SSH
                                           ▼
                                ┌──────────────────────┐
                                │ Parallel SSH session  │
                                │ ssh user@host         │
                                │ (dedicated AI shell)  │
                                └──────────────────────┘
```

### 1. Remote SSH Session Manager

**New file:** `electron/services/remoteSsh.ts`

Manages parallel SSH connections, one per tab.

- **Connection**: Spawns `ssh <user>@<host>` using the user's existing SSH config and SSH agent. No password capture or forwarding — key-based auth only.
- **Lifecycle**: Lazy — connection is established on the first AI request while remote, not on SSH detection. Torn down when the user exits SSH, the tab closes, or the app quits.
- **Timeout**: 10-second connection timeout. On failure, surfaces an error and falls back to local execution.
- **Shell channel**: Provides a dedicated shell for AI command execution, isolated from the user's interactive session.

### 2. Tool Interception via Approval Boundary

The Claude CLI executes tools internally. We intercept at the `approval_needed` message boundary.

**Flow:**
1. Claude CLI emits `approval_needed` for a tool call (e.g., Bash: `ls -la`)
2. Remote tool proxy intercepts (instead of showing approval UI)
3. Proxy denies the tool call to Claude CLI (prevents local execution)
4. Proxy executes the equivalent command on the remote host via SSH
5. Proxy injects the result back to Claude CLI as a `tool_result` message
6. Claude CLI continues as if it executed the tool itself

**Permission mode override:** When in remote exec mode, Claude CLI is forced to `acceptEdits` permission mode regardless of the user's trust setting. This guarantees every tool call produces an `approval_needed` message for interception. The user-facing approval UX remains unchanged.

**Supported tools (remote execution):**

| Tool | Remote Implementation |
|------|----------------------|
| Bash | Command sent through SSH shell with output fencing |
| Read | `cat -n <path>` with `head`/`tail` for offset/limit |
| Write | `cat << 'TAI_EOF_<uuid>' > <path>` heredoc |
| Grep | `grep` or `rg` command on remote |
| Glob | `find` or `ls` command on remote |

**Unsupported tools** (Edit, LSP, NotebookEdit, etc.): Intercepted and denied with an error message returned to Claude: `"This tool is not available on remote hosts. Use Bash with shell commands (cat, sed, tee) to accomplish file operations instead."` Claude will self-correct.

**Output fencing:** Commands are wrapped with unique markers to reliably extract output:
```bash
echo __TAI_START_<uuid>__; <command>; echo __TAI_END_<uuid>__ $?
```
The proxy parses everything between markers, plus the exit code from the end marker.

### 3. Remote Mode State & UI

**State:** `TabState` gains a new field:
```typescript
remoteExecMode: 'auto' | 'local'  // default: 'auto'
```

- `auto` + `isRemote`: AI targets remote host
- `auto` + not remote: AI targets local (normal behavior)
- `local`: AI always targets local, even when SSH'd

**UI toggle:** A small pill/indicator near the trust badge or input area, visible only when `isRemote` is true. Shows "Remote" or "Local" and toggles `remoteExecMode` on click.

### 4. System Prompt Augmentation

When operating in remote mode, the preamble sent to Claude CLI is augmented:

- "You are connected to a remote host: `<user>@<host>`"
- "Available tools: Bash, Read (via cat), Write (via heredoc), Grep (via grep/rg). Use shell commands for file operations."
- "The Edit tool is not available remotely. Use `sed` or write the full file with a heredoc instead."
- "Working directory on remote: `<remote cwd>`"

**Remote CWD tracking:** After each command execution on the SSH channel, a silent `pwd` is run to track the remote working directory for accurate path context in the system prompt.

### 5. Edge Cases & Failure Handling

**Connection failure:**
- Show notification: "Couldn't establish SSH connection to `<user>@<host>`. AI will run commands locally."
- Auto-flip `remoteExecMode` to `'local'`
- User can retry by toggling back

**SSH session ends:**
- `isRemote` flips to false via existing detection
- Parallel SSH connection torn down
- AI reverts to local execution
- New connection established lazily if user SSH's in again

**Command timeout:**
- 30-second default timeout per remote command (configurable)
- On timeout: kill command on SSH channel, return timeout error to Claude

**Output size:**
- Cap at ~100KB per command
- Truncate with `"[output truncated at 100KB]"`

**Shell escaping:**
- Commands passed verbatim to SSH shell within fencing markers
- Heredoc delimiters use random UUIDs to avoid conflicts with file content

## Files Affected

| File | Change |
|------|--------|
| `electron/services/remoteSsh.ts` | New — SSH connection manager |
| `electron/services/remoteToolProxy.ts` | New — tool interception and remote routing |
| `electron/services/claude.ts` | Modified — integrate proxy into message stream, permission override |
| `electron/preload.ts` | Modified — expose remote mode state IPC |
| `src/types.ts` | Modified — add `remoteExecMode` to `TabState` |
| `src/components/TerminalSession.tsx` | Modified — pass remote state to AI provider, augment system prompt |
| `src/components/TerminalInput.tsx` | Modified — show remote/local toggle |
| `src/components/TrustBadge.tsx` | Modified — incorporate remote exec indicator |

## Future: Optional Remote Agent

The agentless approach works on any host with zero setup but has limitations (no Edit tool, shell parsing fragility). A future enhancement could provide an optional lightweight TAI agent binary installed on the remote host, unlocking full tool parity. The agentless path would remain as the fallback.
