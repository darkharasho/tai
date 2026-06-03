import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    // Limit parallelism to avoid exhausting system memory
    pool: 'forks',
    poolOptions: {
      forks: { maxForks: 2, minForks: 1 },
    },
    maxWorkers: 2,
    minWorkers: 1,
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
