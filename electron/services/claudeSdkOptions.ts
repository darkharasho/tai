/** The read-only terminal-history MCP tool is always auto-approved. */
export const HISTORY_TOOL = 'mcp__tai-history__TerminalHistory';

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
}

/**
 * Map TAI's permission mode + remote context to Claude Agent SDK options.
 * - ask         → default      (canUseTool prompts for every tool)
 * - acceptEdits → acceptEdits  (file edits auto; canUseTool prompts for Bash etc.)
 * - bypass      → bypassPermissions
 * - remoteExec  → bypassPermissions + built-ins disallowed (routed via MCP)
 */
export function sdkOptions(input: SdkOptionsInput): SdkOptionsResult {
  const { permMode, model, cwd, sessionId, remoteExec, mcpServers } = input;

  let permissionMode: SdkOptionsResult['permissionMode'];
  if (remoteExec || permMode === 'bypass') permissionMode = 'bypassPermissions';
  else if (permMode === 'ask') permissionMode = 'default';
  else permissionMode = 'acceptEdits';

  const result: SdkOptionsResult = {
    permissionMode,
    allowedTools: [HISTORY_TOOL],
    cwd,
    mcpServers,
  };
  if (permissionMode === 'bypassPermissions') result.allowDangerouslySkipPermissions = true;
  if (remoteExec) result.disallowedTools = REMOTE_DISALLOWED;
  if (model && model !== 'default') result.model = model;
  if (sessionId) result.resume = sessionId;
  return result;
}
