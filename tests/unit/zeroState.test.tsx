// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { createIndex } from '@/utils/commandIndex';
import { zeroStateSuggestion } from '@/components/TerminalInput';

// zeroStateSuggestion is the pure helper the component uses to decide what to
// show on an empty composer.
describe('zeroStateSuggestion', () => {
  it('returns the next-command for an empty shell composer after success', () => {
    expect(zeroStateSuggestion('', 'shell', { lastCommand: 'git add .', lastExitCode: 0, index: createIndex() }))
      .toBe('git commit');
  });
  it('returns null when the composer is non-empty', () => {
    expect(zeroStateSuggestion('g', 'shell', { lastCommand: 'git add .', lastExitCode: 0, index: createIndex() }))
      .toBeNull();
  });
  it('returns null in ai mode', () => {
    expect(zeroStateSuggestion('', 'ai', { lastCommand: 'git add .', lastExitCode: 0, index: createIndex() }))
      .toBeNull();
  });
});
