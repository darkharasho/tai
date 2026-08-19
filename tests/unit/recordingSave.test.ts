import { describe, it, expect, vi } from 'vitest';
import { registerRecordingSave } from '../../electron/services/recordingSave';

function fakeIpcMain() {
  const handlers = new Map<string, (...args: any[]) => any>();
  return {
    handle: (channel: string, fn: (...args: any[]) => any) => { handlers.set(channel, fn); },
    invoke: (channel: string, ...args: any[]) => handlers.get(channel)!({}, ...args),
    has: (channel: string) => handlers.has(channel),
  };
}

describe('registerRecordingSave', () => {
  it('registers the debug:save-recording channel', () => {
    const ipc = fakeIpcMain();
    registerRecordingSave(ipc as any, {
      showSaveDialog: async () => ({ canceled: true }),
      writeFile: async () => {},
      defaultDir: () => '/tmp',
    });
    expect(ipc.has('debug:save-recording')).toBe(true);
  });

  it('writes the recording to the chosen path and returns it', async () => {
    const ipc = fakeIpcMain();
    const writeFile = vi.fn(async () => {});
    registerRecordingSave(ipc as any, {
      showSaveDialog: async () => ({ canceled: false, filePath: '/home/u/rec.jsonl' }),
      writeFile,
      defaultDir: () => '/tmp',
    });

    const result = await ipc.invoke('debug:save-recording', '{"t":0,"kind":"data","d":"aGk="}', 'tai-pty-3.jsonl');

    expect(writeFile).toHaveBeenCalledWith('/home/u/rec.jsonl', '{"t":0,"kind":"data","d":"aGk="}');
    expect(result).toBe('/home/u/rec.jsonl');
  });

  it('writes nothing and returns null when the user cancels', async () => {
    const ipc = fakeIpcMain();
    const writeFile = vi.fn(async () => {});
    registerRecordingSave(ipc as any, {
      showSaveDialog: async () => ({ canceled: true }),
      writeFile,
      defaultDir: () => '/tmp',
    });

    const result = await ipc.invoke('debug:save-recording', 'x', 'tai-pty-1.jsonl');

    expect(writeFile).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it('rejects a non-string payload rather than writing it', async () => {
    const ipc = fakeIpcMain();
    const writeFile = vi.fn(async () => {});
    registerRecordingSave(ipc as any, {
      showSaveDialog: async () => ({ canceled: false, filePath: '/x' }),
      writeFile,
      defaultDir: () => '/tmp',
    });

    const result = await ipc.invoke('debug:save-recording', { evil: true }, 'n.jsonl');

    expect(writeFile).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it('defaults the save path into the provided directory', async () => {
    const ipc = fakeIpcMain();
    const showSaveDialog = vi.fn(async () => ({ canceled: true }));
    registerRecordingSave(ipc as any, {
      showSaveDialog,
      writeFile: async () => {},
      defaultDir: () => '/home/u/Documents',
    });

    await ipc.invoke('debug:save-recording', 'x', 'tai-pty-7.jsonl');

    expect(showSaveDialog).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: '/home/u/Documents/tai-pty-7.jsonl' }),
    );
  });
});
