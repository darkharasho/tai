// tests/unit/nextCommand.test.ts
import { describe, it, expect } from 'vitest';
import { predictNextCommand } from '@/utils/nextCommand';
import { createIndex, ingestBlock } from '@/utils/commandIndex';

describe('predictNextCommand', () => {
  it('suggests git commit after a successful git add', () => {
    expect(predictNextCommand({ lastCommand: 'git add .', lastExitCode: 0, index: createIndex() }))
      .toBe('git commit');
  });

  it('suggests git status after cd into a directory', () => {
    expect(predictNextCommand({ lastCommand: 'cd my-repo', lastExitCode: 0, index: createIndex() }))
      .toBe('git status');
  });

  it('returns null after a failed command (ErrorAffordance owns it)', () => {
    expect(predictNextCommand({ lastCommand: 'git add .', lastExitCode: 1, index: createIndex() }))
      .toBeNull();
  });

  it('falls back to co-occurrence when no chain rule matches', () => {
    const index = createIndex();
    ingestBlock(index, { command: 'pytest', ts: 1, prevCommand: 'ruff check' });
    ingestBlock(index, { command: 'pytest', ts: 2, prevCommand: 'ruff check' });
    expect(predictNextCommand({ lastCommand: 'ruff check', lastExitCode: 0, index }))
      .toBe('pytest');
  });

  it('chain rule beats co-occurrence', () => {
    const index = createIndex();
    ingestBlock(index, { command: 'git log', ts: 1, prevCommand: 'git add .' });
    expect(predictNextCommand({ lastCommand: 'git add .', lastExitCode: 0, index }))
      .toBe('git commit');
  });

  it('returns null for an unknown command with no history', () => {
    expect(predictNextCommand({ lastCommand: 'frobnicate', lastExitCode: 0, index: createIndex() }))
      .toBeNull();
  });
});
