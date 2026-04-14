import { vi } from 'vitest';

export const ipcMain = {
  handle: vi.fn(),
  on: vi.fn(),
};

export class BrowserWindow {}
