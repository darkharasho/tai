import type { EffortLevel, ThinkingConfig } from '@anthropic-ai/claude-agent-sdk';

/** The read-only terminal-history MCP tool is always auto-approved. */
export const HISTORY_TOOL = 'mcp__tai-history__TerminalHistory';

const EFFORT_LEVELS: readonly EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max'];

/** Built-in tools disallowed on the remote-exec path so the model uses the
 *  remote MCP toolset (whose calls run on the remote host) instead. */
export const REMOTE_DISALLOWED = ['Bash', 'Read', 'Write', 'Edit', 'Grep', 'Glob', 'WebFetch', 'WebSearch'];

export interface SdkOptionsInput {
  permMode: string;
  model: string;
  cwd: string;
  sessionId: string | null;
  remoteExec: boolean;
  mcpServers: Record<string, unknown>;
  /** Reasoning effort selector from settings ('auto' → let the model decide). */
  effort?: string;
  /** When false, request thinking summaries be omitted (reasoning text hidden). */
  showReasoning?: boolean;
}

export interface SdkOptionsResult {
  permissionMode: 'default' | 'acceptEdits' | 'bypassPermissions';
  allowDangerouslySkipPermissions?: boolean;
  allowedTools: string[];
  disallowedTools?: string[];
  model?: string;
  resume?: string;
  cwd: string;
  mcpServers: Record<string, unknown>;
  thinking?: ThinkingConfig;
  effort?: EffortLevel;
  includePartialMessages: boolean;
}

/**
 * Map TAI's permission mode + remote context to Claude Agent SDK options.
 * - ask         → default      (canUseTool prompts for every tool)
 * - acceptEdits → acceptEdits  (file edits auto; canUseTool prompts for Bash etc.)
 * - bypass      → bypassPermissions
 * - remoteExec  → bypassPermissions + built-ins disallowed (routed via MCP)
 */
export function sdkOptions(input: SdkOptionsInput): SdkOptionsResult {
  const { permMode, model, cwd, sessionId, remoteExec, mcpServers, effort, showReasoning } = input;

  let permissionMode: SdkOptionsResult['permissionMode'];
  if (remoteExec || permMode === 'bypass') permissionMode = 'bypassPermissions';
  else if (permMode === 'ask') permissionMode = 'default';
  else permissionMode = 'acceptEdits';

  const result: SdkOptionsResult = {
    permissionMode,
    allowedTools: [HISTORY_TOOL],
    cwd,
    mcpServers,
    // Without this the SDK only yields whole assistant messages, so reasoning
    // and answer text land in one lump when the turn is already over. Partial
    // messages give us the token-level deltas the UI streams.
    includePartialMessages: true,
  };
  if (permissionMode === 'bypassPermissions') result.allowDangerouslySkipPermissions = true;
  if (remoteExec) result.disallowedTools = REMOTE_DISALLOWED;
  if (model && model !== 'default') result.model = model;
  if (sessionId) result.resume = sessionId;

  // Adaptive thinking lets the model decide when/how much to reason. `display`
  // controls whether the reasoning summary is streamed back: 'summarized'
  // surfaces the reasoning text in the UI, 'omitted' hides it (the default the
  // API would otherwise use). Reasoning still happens either way — only its
  // visibility changes — so the toggle disables the *text*, not the thinking.
  result.thinking = { type: 'adaptive', display: showReasoning === false ? 'omitted' : 'summarized' };
  if (effort && effort !== 'auto' && (EFFORT_LEVELS as readonly string[]).includes(effort)) {
    result.effort = effort as EffortLevel;
  }
  return result;
}
