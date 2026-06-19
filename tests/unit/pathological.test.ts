import { describe, it, expect } from 'vitest';
import { pathological } from '../fixtures/pathological';

describe('pathological fixtures', () => {
  it('exposes non-empty adversarial strings', () => {
    for (const [k, v] of Object.entries(pathological)) {
      expect(typeof v, k).toBe('string');
      expect(v.length, k).toBeGreaterThan(0);
    }
  });
  it('hugeLine is a single line of ~10MB', () => {
    expect(pathological.hugeLine.length).toBeGreaterThan(5_000_000);
    expect(pathological.hugeLine.includes('\n')).toBe(false);
  });
});
