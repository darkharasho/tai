// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { persistBlocks } from '@/utils/sessionRestore';

function makeItems(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    type: 'command' as const, active: false,
    block: { id: `b${i}`, command: `cmd ${i}`, output: 'x'.repeat(500), rawOutput: 'x'.repeat(500) },
  })) as any;
}

describe('persistBlocks quota handling', () => {
  let store: Record<string, string>;
  beforeEach(() => {
    store = {};
    let failOnce = true;
    (globalThis as any).localStorage = {
      getItem: (k: string) => store[k] ?? null,
      removeItem: (k: string) => { delete store[k]; },
      setItem: vi.fn((k: string, v: string) => {
        if (failOnce && v.length > 2000) {
          failOnce = false;
          const e: any = new Error('quota'); e.name = 'QuotaExceededError'; throw e;
        }
        store[k] = v;
      }),
    };
  });

  it('sheds oldest blocks and retries on QuotaExceededError', () => {
    persistBlocks('tab-1', makeItems(40));
    // After a quota failure it should have retried with fewer blocks and succeeded.
    expect(store['tai:session:tab-1']).toBeTruthy();
    const saved = JSON.parse(store['tai:session:tab-1']);
    expect(saved.blocks.length).toBeLessThan(40);
  });
});
