import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '../src'),
      electron: path.resolve(__dirname, './__mocks__/electron.ts'),
      'node:path': 'path',
      'node:fs': 'fs',
      'node:os': 'os',
      'node:child_process': 'child_process',
    },
    conditions: ['node'],
  },
});
