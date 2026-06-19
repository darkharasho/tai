import { describe, it, expect } from 'vitest';
import { createIndex, ingestBlock, rankPrefix } from '@/utils/commandIndex';

// Behavioral contract the wiring must satisfy: a finished block becomes a
// ranked, cwd-aware suggestion. (Pure-logic proxy for the wiring.)
describe('block ingestion feeds ghost ranking', () => {
  it('a finalized block in a cwd ranks first for that cwd', () => {
    const idx = createIndex();
    ingestBlock(idx, { command: 'terraform apply', cwd: '/infra', exitCode: 0, ts: Date.now() });
    expect(rankPrefix(idx, 'terraform a', Date.now(), '/infra')[0]).toBe('terraform apply');
  });
});
