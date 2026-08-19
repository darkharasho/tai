import path from 'node:path';

/**
 * Saving a PTY recording is an explicit, user-initiated action. The ring buffer
 * that feeds it lives in renderer memory and never touches disk on its own —
 * no auto-save, no crash dump, no temp file.
 *
 * The recording is deliberately NOT passed through redactSecrets: it holds raw
 * bytes, and rewriting them would corrupt the escape sequences that make the
 * recording reproducible in the first place. Redaction belongs on the
 * export/share path, not on capture.
 */
export interface RecordingSaveDeps {
  showSaveDialog: (opts: { defaultPath: string }) => Promise<{ canceled: boolean; filePath?: string }>;
  writeFile: (filePath: string, data: string) => Promise<void>;
  defaultDir: () => string;
}

export function registerRecordingSave(
  ipcMain: Electron.IpcMain,
  deps: RecordingSaveDeps,
): void {
  ipcMain.handle('debug:save-recording', async (_event, jsonl: unknown, filename: unknown) => {
    if (typeof jsonl !== 'string') return null;
    const name = typeof filename === 'string' && filename ? filename : 'tai-pty.jsonl';
    const res = await deps.showSaveDialog({
      defaultPath: path.join(deps.defaultDir(), name),
    });
    if (res.canceled || !res.filePath) return null;
    await deps.writeFile(res.filePath, jsonl);
    return res.filePath;
  });
}
