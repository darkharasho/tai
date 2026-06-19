import { describe, it, expect } from 'vitest';
import { TermEmulator } from '@/utils/termEmulator';
import { ansiToHtml } from '@/utils/ansiToHtml';
import { pathological } from '../fixtures/pathological';

describe('adversarial input pipeline', () => {
  for (const [name, input] of Object.entries(pathological)) {
    it(`is bounded and throw-free: ${name}`, () => {
      const e = new TermEmulator();
      const start = Date.now();
      expect(() => e.feed(input)).not.toThrow();
      const text = e.text();
      expect(text.split('\n').length).toBeLessThan(100_000);
      expect(() => ansiToHtml(text)).not.toThrow();
      expect(Date.now() - start).toBeLessThan(3000);
    });
  }
});
