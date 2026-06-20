# Migrate the Claude provider to the Claude Agent SDK — Design

Date: 2026-06-20
Status: Approved design, pending spec review → implementation plan

## Problem

TAI's Claude provider (`electron/services/claude.ts`) shells out to the globally
installed `claude` CLI in stream-json mode and implements tool approval by a
brittle, now-broken mechanism:

1. It forces the CLI to **deny** tools (via permission mode / disallowed-tools),
   detects the denial by **scraping English error strings** out of `tool_result`
   blocks (`claude.ts:256–279`), shows an approval popup, and then
   **re-implements the tool itself** in Electron (Bash via `execFile('bash', …)`,
   Write/Edit/Read via `fs`; `claude.ts:560–650`).
2. CLI v2.1.183 no longer denies with those strings in `plan`/`acceptEdits` — it
   just runs the tool — so the denial is never detected: the approval popup
   doesn't fire, or if it does, `ai:approve` bails because `awaitingApproval`
   was never set. **Affects every platform with a recent CLI.**
3. On Windows, even when a popup shows, approving a Bash tool runs
   `execFile('bash', …)` — **there is no `bash` on Windows** — so approve does
   nothing. Re-running the model's bash-syntax commands locally can never work
   on Windows regardless of patching.

Separately, on Windows the AI also has **no command/conversation context**
because TAI's context comes from OSC 133 shell-integration markers that
cmd.exe/PowerShell don't emit (tracked as a separate follow-up spec, not this
one).

## Goal

Replace the hand-spawned CLI with the official **Claude Agent SDK**
(`@anthropic-ai/claude-agent-sdk`), using its `canUseTool` permission callback
for approvals and letting the SDK execute tools natively (cross-platform). This
deletes the denial-scraping and the local tool re-implementation, fixing the
approval regression on all platforms and the Windows Bash-approval failure.

Scope: **full migration** — both the local and the remote/daemon execution
paths move onto the SDK in this spec. `gemini.ts` has the same brittle pattern
but is a separate provider and is **out of scope** (follow-up).

## Authoritative SDK facts (verified against the Agent SDK reference)

- `query({ prompt, options }): Query` — `prompt` is `string |
  AsyncIterable<SDKUserMessage>`; the return is an async generator of
  `SDKMessage` with helper methods (`interrupt()`, `setMcpServers()`, etc.).
- `canUseTool: (toolName, input, { signal, toolUseID, … }) =>
  Promise<PermissionResult>` where `PermissionResult` is
  `{ behavior: "allow", updatedInput? }` or `{ behavior: "deny", message }`.
  The SDK awaits this before running the tool, then executes the tool itself.
- `permissionMode`: `"default" | "acceptEdits" | "bypassPermissions" | "plan" |
  "dontAsk" | "auto"`. `bypassPermissions` requires
  `allowDangerouslySkipPermissions: true`.
- `allowedTools` / `disallowedTools`: `string[]`.
- `mcpServers`: `Record<string, McpServerConfig>` (`stdio | sse | http | sdk`).
- `resume`: a prior `sessionId`; `continue`: boolean.
- Streaming input: pass an `AsyncIterable<SDKUserMessage>` as `prompt`.
- Output message types include `SDKAssistantMessage` (`message: BetaMessage`),
  `SDKUserMessage` (tool results), `SDKResultMessage`
  (`subtype: "success" | "error_*"`, `total_cost_usd`, `usage`), plus progress
  and permission-denied messages.
- **Auth:** the SDK uses the user's existing Claude login (OAuth tokens in the
  `.claude` config dir); no API key. It bundles a native Claude Code binary as
  an optional dependency. `pathToClaudeCodeExecutable` overrides the binary path.

## Renderer protocol (kept stable)

The renderer (`TerminalSession.tsx` ~913–1067) consumes `ai:message` envelopes:
`{type:'assistant', message:{content:[…]}}`, `{type:'user',
message:{content:[tool_result…]}}`, `{type:'approval_needed', toolUseId,
toolName, command, input}`, `{type:'result', …}`, `{type:'done'}`,
`{type:'error', text}`, and the `remote:*` events. The content blocks
(`text`/`tool_use`/`tool_result`) are standard Anthropic blocks the SDK also
emits, so the migration **preserves this protocol** and translates SDK output
into it. Renderer changes are minimal.

## Architecture

Per tab, run one **long-lived streaming `query()`**: an async input queue feeds
user turns in; the output generator streams `SDKMessage`s; a `canUseTool`
callback gates every tool. The local path lets the SDK run tools natively; the
remote/daemon path routes tool execution through the existing daemon/SSH MCP
server passed via `options.mcpServers` + `disallowedTools`.

```
ai:send ─▶ enqueue {type:'user',message} ─▶ SDK consumes
   SDK ─▶ assistant text / tool_use ─▶ canUseTool(toolName,input,{toolUseID})
   canUseTool ─▶ emit approval_needed ─▶ (await) ─▶ ai:approve resolves allow/deny
   allow ─▶ SDK runs tool natively ─▶ tool_result streams back ─▶ assistant continues
   end ─▶ SDKResultMessage ─▶ {type:'result'} + {type:'done'}
```

## Components (each independently testable)

1. **`sdkOptions(input)` (pure)** — maps
   `{ permMode, model, effort, cwd, sessionId, remote }` to the SDK `Options`
   object: `permissionMode`, `allowedTools`, `disallowedTools`, `mcpServers`,
   `model`, `resume`, `cwd`. File: `electron/services/claudeSdkOptions.ts`.

2. **`translateSdkMessage(msg)` (pure)** — maps an `SDKMessage` to zero or more
   renderer envelopes:
   - `assistant` → `{type:'assistant', message: msg.message}`
   - `user` (tool results) → `{type:'user', message: msg.message}`
   - `result` success → `{type:'result', content: msg}` then `{type:'done'}`
   - `result` `error_*` → `{type:'error', text, category}` then `{type:'done'}`
   - progress / system / unknown → `[]` (ignored)
   File: `electron/services/claudeSdkTranslate.ts`.

3. **`ApprovalBridge`** — holds a `Map<toolUseID, (PermissionResult)=>void>`.
   - `requestApproval(toolUseID, toolName, input, emit)` registers a resolver,
     calls `emit({type:'approval_needed', toolUseId, toolName,
     command: toolCommandString(input), input})`, and returns a Promise.
   - `resolve(toolUseID, approved)` settles the Promise with
     `{behavior:'allow'}` or `{behavior:'deny', message:'User denied the tool
     use.'}`; returns false if no pending entry.
   - `clear()` denies+drops all pending (on abort/exit).
   File: `electron/services/claudeApprovalBridge.ts`. Unit-tested.

4. **Session manager (`claude.ts` rewrite)** — per-tab state:
   `{ inputQueue, query, sessionId, abort, approvals: ApprovalBridge, busy,
   remoteTarget, remoteExecMode, daemon… }`. Starts the streaming query on
   first `ai:send`, enqueues subsequent sends, captures `sessionId` from the
   result/system messages for `resume` after a restart, and drives the output
   loop translating messages to `ai:message`.

## Permission-mode mapping

| TAI permMode | SDK `permissionMode` | canUseTool behavior |
|---|---|---|
| `ask` | `default` | prompt for every tool |
| `acceptEdits` (default) | `acceptEdits` | auto file edits; prompt for Bash and other non-edit tools |
| `bypass` | `bypassPermissions` (+ `allowDangerouslySkipPermissions`) | never prompt |
| remote-exec (`remoteTarget` && mode `auto`) | `bypassPermissions` | never prompt; tools routed to daemon via MCP |

The read-only `mcp__tai-history__TerminalHistory` tool is always auto-approved
via `allowedTools` so it never raises a popup.

## Remote / daemon path

Reuse the existing daemon/SSH machinery. Instead of CLI flags, pass:
`options.mcpServers = { 'tai-history': …, 'tai-remote': … }` and
`options.disallowedTools = ['Bash','Read','Write','Edit','Grep','Glob','WebFetch','WebSearch']`
so the model uses the remote MCP toolset, whose calls the existing
`daemonProxy`/`toolProxy.executeRemoteTool` execute on the remote host. The MCP
server scripts (`generateHistoryMcpConfig`, `generateMcpServerScript`) are
unchanged; only how they're handed to the engine changes (SDK option vs CLI
`--mcp-config`). `canUseTool` still gates in non-bypass modes.

## What gets deleted

- Denial-string detection (`claude.ts:256–279`).
- The local tool re-implementation block (`claude.ts:~560–650`): Bash
  `execFile('bash', …)`, Write/Edit/Read via `fs`, and the unknown-tool
  settings.local.json allow-list write. **This is the Windows fix** — the SDK
  runs every tool natively.
- Manual stdout stream-json line parsing (`claude.ts:196–303`).
- The `--permission-mode plan` denial trick, `--disallowed-tools`-for-denial,
  and `state.approvalBuffered` machinery (`canUseTool` blocks the loop directly,
  so there is nothing to buffer).
- `resolveBinary('claude', …)` CLI spawn plumbing.

## Error handling & lifecycle

- `SDKResultMessage.subtype === 'error_*'` or a thrown error from the generator
  → `ai:error` (run text through `classifyProviderError` for the category) then
  `{type:'done'}`.
- `ai:stop` / tab close → `query.interrupt()` + abort the `AbortController`,
  `approvals.clear()`, mark not busy, emit `{type:'done'}`.
- The idle watchdog is retained (kick on each yielded message; on timeout abort
  and emit a timeout error + done).
- Auth failures surface as SDK errors → `ai:error` with the auth category.

## Testing

- **Unit:** `sdkOptions` (each permMode + remote → expected option object);
  `translateSdkMessage` (assistant / tool-result user / result-success /
  result-error / ignored types, with fixtures); `ApprovalBridge`
  (register→resolve allow, resolve deny, unknown id returns false, clear denies
  all). Run via `npx vitest run --config tests/vitest.config.ts --maxWorkers=2`.
- **Manual smoke (gate):** on **Linux and Windows** — `ask` mode: a Bash tool
  shows the popup, Approve runs it and the AI continues, Deny stops it;
  `acceptEdits`: file edits auto-run but Bash still prompts; multi-turn session
  continuity (second `ai:send` continues the same conversation); `ai:stop`
  mid-tool aborts cleanly; remote-exec routes a tool to the daemon. No `bash`
  ENOENT on Windows.

## Packaging (release risk — explicit task in the plan)

The SDK bundles a native Claude Code binary as an optional dependency.
`electron-builder` config must include it in the asar-unpacked files for
Linux/Windows/macOS, and the main process must resolve its path in the packaged
app (set `pathToClaudeCodeExecutable` if auto-resolution fails inside `app.asar`).
The plan includes a dedicated packaging-and-verify task; this must pass before
the migration ships in a release.

## Out of scope (YAGNI / follow-up)

- `gemini.ts` migration (same pattern, separate provider).
- Windows shell-integration / OSC 133 context capture (separate spec — the
  other reported bug).
- Codex provider (separate).

## Key files

- `electron/services/claude.ts` — rewritten to drive the SDK.
- `electron/services/claudeSdkOptions.ts` — new (pure).
- `electron/services/claudeSdkTranslate.ts` — new (pure).
- `electron/services/claudeApprovalBridge.ts` — new.
- `electron/preload.ts` — `ai:*` channel signatures unchanged; verify only.
- `package.json` / electron-builder config — add `@anthropic-ai/claude-agent-sdk`
  dependency and bundle its binary.
- `tests/unit/claudeSdkOptions.test.ts`, `claudeSdkTranslate.test.ts`,
  `claudeApprovalBridge.test.ts` — new.
