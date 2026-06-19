import { describe, it, expect } from 'vitest';
import { TermEmulator } from '@/utils/termEmulator';
import { pathological } from '../fixtures/pathological';

describe('TermEmulator allocation bounds', () => {
  it('does not allocate millions of lines on an insert-line bomb', () => {
    const e = new TermEmulator();
    e.feed(pathological.insertLineBomb);
    expect(e.text().split('\n').length).toBeLessThan(100_000);
  });

  it('does not hang or throw on a cursor bomb', () => {
    const e = new TermEmulator();
    expect(() => e.feed(pathological.cursorBomb)).not.toThrow();
    expect(e.text()).toContain('done');
  });

  it('completes a 10MB single line quickly and bounded', () => {
    const e = new TermEmulator();
    const start = Date.now();
    e.feed(pathological.hugeLine);
    expect(Date.now() - start).toBeLessThan(2000);
  });
});
