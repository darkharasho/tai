import { describe, it, expect } from 'vitest';
import { serializeIndex, deserializeIndex, MAX_FILE_BYTES } from '../../electron/services/commandIndexStore';
import { createIndex, ingestBlock } from '../../src/utils/commandIndex';

describe('commandIndexStore (de)serialize', () => {
  it('round-trips an index', () => {
    const idx = createIndex();
    ingestBlock(idx, { command: 'ls', cwd: '/a', ts: 5 });
    const back = deserializeIndex(serializeIndex(idx), 100);
    expect(back.stats['ls'].count).toBe(1);
    expect(back.stats['ls'].cwdCounts['/a']).toBe(1);
  });

  it('returns a fresh index for null/garbage/oversized input', () => {
    expect(Object.keys(deserializeIndex(null, 1).stats)).toHaveLength(0);
    expect(Object.keys(deserializeIndex('{not json', 1).stats)).toHaveLength(0);
    expect(Object.keys(deserializeIndex('{"stats":42}', 1).stats)).toHaveLength(0);
  });

  it('coerces an array next-map to {} (does not pass array through)', () => {
    const result = deserializeIndex('{"stats":{},"next":[]}', 1);
    expect(Array.isArray(result.next)).toBe(false);
    expect(typeof result.next).toBe('object');
    expect(Object.keys(result.stats)).toHaveLength(0);
  });

  it('caps an oversized deserialized index', () => {
    const idx = createIndex();
    for (let i = 0; i < 5000; i++) ingestBlock(idx, { command: `c${i}`, ts: i });
    const back = deserializeIndex(serializeIndex(idx), 10000);
    expect(Object.keys(back.stats).length).toBeLessThanOrEqual(2000);
  });

  it('deserializeIndex returns empty index when raw string exceeds MAX_FILE_BYTES', () => {
    // Passing a string longer than MAX_FILE_BYTES must return a fresh index
    // without attempting JSON.parse, satisfying the "oversized → empty" contract.
    const oversized = 'x'.repeat(MAX_FILE_BYTES + 1);
    const result = deserializeIndex(oversized, 1);
    expect(Object.keys(result.stats)).toHaveLength(0);
    expect(Object.keys(result.next)).toHaveLength(0);
  });
});
