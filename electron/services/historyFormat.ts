export interface HistoryEntry {
  command: string;
  output?: string;
  exitCode?: number;
  cwd?: string;
  gitBranch?: string | null;
  durationMs?: number;
  timestamp?: number;
}

/**
 * Render history entries into the text returned by the TerminalHistory MCP tool.
 * MUST stay self-contained (no imports/closures): its source is embedded via
 * Function.prototype.toString() into the standalone MCP server script.
 */
export function formatHistoryEntries(entries: HistoryEntry[]): string {
  if (!entries || entries.length === 0) return 'No terminal history available.';
  const lines: string[] = [];
  for (const entry of entries) {
    const exitStr = entry.exitCode !== undefined && entry.exitCode !== 0
      ? ' [exit ' + entry.exitCode + ']' : '';
    const meta: string[] = [];
    if (entry.cwd) meta.push(entry.cwd);
    if (entry.gitBranch) meta.push('git:' + entry.gitBranch);
    if (entry.durationMs !== undefined) meta.push((entry.durationMs / 1000).toFixed(1) + 's');
    const metaStr = meta.length ? '  (' + meta.join(', ') + ')' : '';
    lines.push('$ ' + entry.command + exitStr + metaStr);
    if (entry.output && entry.output.trim()) {
      let out = entry.output;
      if (out.length > 2000) {
        out = out.slice(0, 1000) + '\n... (' + (out.length - 2000) + ' chars truncated) ...\n' + out.slice(-1000);
      }
      lines.push(out.trim());
    }
    lines.push('');
  }
  return lines.join('\n');
}
