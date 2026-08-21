import { describe, it, expect } from 'vitest';
import {
  loadLearnedVerdicts,
  recordCorrection,
  LEARN_KEY,
  COUNT_CAP,
  MAX_TOKENS,
} from '@/utils/classifierMemory';

/** Minimal localStorage stand-in. */
const store = () => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    raw: () => JSON.parse(m.get(LEARN_KEY) ?? '{}'),
  };
};

describe('loadLearnedVerdicts', () => {
  it('is empty for a store that has never been written', () => {
    expect(loadLearnedVerdicts(store()).size).toBe(0);
  });

  it('survives corrupt JSON rather than throwing', () => {
    const s = store();
    s.setItem(LEARN_KEY, '{not json');
    expect(loadLearnedVerdicts(s).size).toBe(0);
  });

  it('survives a storage that throws (private mode, quota)', () => {
    const dead = {
      getItem: () => { throw new Error('nope'); },
      setItem: () => { throw new Error('nope'); },
    };
    expect(loadLearnedVerdicts(dead).size).toBe(0);
    expect(() => recordCorrection('find x', 'ai', 'nl-starter', dead)).not.toThrow();
  });
});

describe('recordCorrection — the net-2 threshold', () => {
  // Shift-Tab sits right next to Tab. One stray press must teach nothing.
  it('does not fire on a single correction', () => {
    const s = store();
    recordCorrection('find the bug', 'ai', 'nl-starter', s);
    expect(loadLearnedVerdicts(s).size).toBe(0);
  });

  it('fires on the second correction in the same direction', () => {
    const s = store();
    recordCorrection('find the bug', 'ai', 'nl-starter', s);
    recordCorrection('find the leak', 'ai', 'nl-starter', s);
    expect(loadLearnedVerdicts(s).get('find')).toBe('ai');
  });

  it('learns in the shell direction too', () => {
    const s = store();
    recordCorrection('explain foo', 'shell', 'nl-starter', s);
    recordCorrection('explain bar', 'shell', 'nl-starter', s);
    expect(loadLearnedVerdicts(s).get('explain')).toBe('shell');
  });

  it('keys on the first token, lowercased, ignoring the rest of the input', () => {
    const s = store();
    recordCorrection('Find the bug', 'ai', 'nl-starter', s);
    recordCorrection('FIND anything else', 'ai', 'nl-starter', s);
    expect(loadLearnedVerdicts(s).get('find')).toBe('ai');
  });
});

describe('recordCorrection — reversal', () => {
  it('decrements the opposite direction, so two corrections turn a habit around', () => {
    const s = store();
    recordCorrection('find a', 'ai', 'nl-starter', s);
    recordCorrection('find b', 'ai', 'nl-starter', s);
    expect(loadLearnedVerdicts(s).get('find')).toBe('ai');

    recordCorrection('find c', 'shell', 'learned', s);   // net 1
    expect(loadLearnedVerdicts(s).has('find')).toBe(false);
    recordCorrection('find d', 'shell', 'learned', s);   // net 0
    recordCorrection('find e', 'shell', 'learned', s);   // net -1
    recordCorrection('find f', 'shell', 'learned', s);   // net -2
    expect(loadLearnedVerdicts(s).get('find')).toBe('shell');
  });

  it('floors a direction at zero rather than going negative', () => {
    const s = store();
    recordCorrection('find a', 'shell', 'nl-starter', s);
    expect(s.raw().find).toEqual({ ai: 0, shell: 1 });
  });
});

describe('recordCorrection — caps', () => {
  it('caps a direction so stale votes cannot be insurmountable', () => {
    const s = store();
    for (let i = 0; i < COUNT_CAP + 20; i++) recordCorrection('find x', 'ai', 'nl-starter', s);
    expect(s.raw().find.ai).toBe(COUNT_CAP);
  });

  it('evicts the lowest-total token once the map is full', () => {
    const s = store();
    // 'weak' gets one vote; everything else gets two.
    recordCorrection('weak x', 'ai', 'nl-starter', s);
    for (let i = 0; i < MAX_TOKENS; i++) {
      recordCorrection(`tok${i} x`, 'ai', 'nl-starter', s);
      recordCorrection(`tok${i} y`, 'ai', 'nl-starter', s);
    }
    const raw = s.raw();
    expect(Object.keys(raw).length).toBeLessThanOrEqual(MAX_TOKENS);
    expect(raw.weak).toBeUndefined();
  });
});

describe('recordCorrection — what is not worth learning', () => {
  // These rungs sit ABOVE `learned` in the cascade, so an entry created from
  // them could never fire, and it would distort the token's counts for the
  // cases where it could.
  it.each(['shell-syntax', 'agent-cli', 'question-mark', 'empty'] as const)(
    'records nothing when the deciding rung was %s',
    (source) => {
      const s = store();
      recordCorrection('find x', 'ai', source, s);
      recordCorrection('find y', 'ai', source, s);
      expect(loadLearnedVerdicts(s).size).toBe(0);
    },
  );

  it.each(['./deploy now', 'VAR=1 npm start', '  ', '~/bin/tool go'])(
    'records nothing for a first token that is not a plain word: %s',
    (input) => {
      const s = store();
      recordCorrection(input, 'shell', 'nl-starter', s);
      recordCorrection(input, 'shell', 'nl-starter', s);
      expect(loadLearnedVerdicts(s).size).toBe(0);
    },
  );
});
