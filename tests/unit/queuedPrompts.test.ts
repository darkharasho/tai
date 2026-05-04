import { describe, it, expect } from 'vitest';
import {
  addQueuedPrompt,
  editQueuedPrompt,
  removeQueuedPrompt,
  joinQueuedPrompts,
} from '@/utils/queuedPrompts';

describe('queuedPrompts', () => {
  it('addQueuedPrompt appends a new entry with a unique id', () => {
    const a = addQueuedPrompt([], 'hello');
    expect(a).toHaveLength(1);
    expect(a[0].text).toBe('hello');
    expect(a[0].id).toBeTruthy();

    const b = addQueuedPrompt(a, 'world');
    expect(b).toHaveLength(2);
    expect(b[1].text).toBe('world');
    expect(b[0].id).not.toBe(b[1].id);
  });

  it('addQueuedPrompt ignores empty / whitespace-only text', () => {
    expect(addQueuedPrompt([], '')).toHaveLength(0);
    expect(addQueuedPrompt([], '   ')).toHaveLength(0);
    expect(addQueuedPrompt([], '\n\n')).toHaveLength(0);
  });

  it('editQueuedPrompt updates only the matching id', () => {
    const seed = addQueuedPrompt(addQueuedPrompt([], 'one'), 'two');
    const edited = editQueuedPrompt(seed, seed[0].id, 'ONE');
    expect(edited[0].text).toBe('ONE');
    expect(edited[1].text).toBe('two');
    expect(edited[0].id).toBe(seed[0].id);
  });

  it('editQueuedPrompt removes the entry when new text is empty', () => {
    const seed = addQueuedPrompt(addQueuedPrompt([], 'one'), 'two');
    const edited = editQueuedPrompt(seed, seed[0].id, '   ');
    expect(edited).toHaveLength(1);
    expect(edited[0].text).toBe('two');
  });

  it('removeQueuedPrompt drops only the matching id', () => {
    const seed = addQueuedPrompt(addQueuedPrompt([], 'one'), 'two');
    const next = removeQueuedPrompt(seed, seed[0].id);
    expect(next).toHaveLength(1);
    expect(next[0].text).toBe('two');
  });

  it('removeQueuedPrompt is a no-op for unknown ids', () => {
    const seed = addQueuedPrompt([], 'one');
    expect(removeQueuedPrompt(seed, 'nope')).toEqual(seed);
  });

  it('joinQueuedPrompts joins entries with double-newline', () => {
    const seed = addQueuedPrompt(addQueuedPrompt([], 'first'), 'second');
    expect(joinQueuedPrompts(seed)).toBe('first\n\nsecond');
  });

  it('joinQueuedPrompts returns empty string for an empty queue', () => {
    expect(joinQueuedPrompts([])).toBe('');
  });
});
