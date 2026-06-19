// electron/services/tempCleanup.ts
import * as fs from 'fs';
import * as path from 'path';

// Matches all tai-* temp file prefixes written by claude.ts:
//   tai-history-*        (historyFilePath)
//   tai-mcp-history-*    (historyServerPath)
//   tai-ssh-config-*     (sshConfigPath)
//   tai-mcp-server-*     (mcpServerPath)
//   tai-mcp-config-*     (mcpConfigPath)
const TAI_TEMP_RE = /^tai-(mcp-server|mcp-config|mcp-history|ssh-config|history)/;

// TAI writes per-request temp files cleaned on graceful provider exit; a crash
// orphans them. Sweep stale ones at startup.
export function purgeStaleTempFiles(dir: string, now = Date.now(), maxAgeMs = 24 * 3600 * 1000): number {
  let removed = 0;
  let entries: string[];
  try { entries = fs.readdirSync(dir); } catch { return 0; }
  for (const name of entries) {
    if (!TAI_TEMP_RE.test(name)) continue;
    const full = path.join(dir, name);
    try {
      if (now - fs.statSync(full).mtimeMs > maxAgeMs) { fs.unlinkSync(full); removed++; }
    } catch { /* ignore */ }
  }
  return removed;
}
