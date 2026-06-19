// tests/unit/palette.test.ts
import { describe, it, expect } from 'vitest';
import { rankPaletteItems, PaletteItem } from '@/utils/palette';

const items: PaletteItem[] = [
  { id: '1', label: 'git checkout', value: 'git checkout', source: 'history' },
  { id: '2', label: 'Deploy prod', value: 'deploy {{env}}', source: 'workflow' },
  { id: '3', label: 'grep', value: 'grep', source: 'command' },
];

describe('rankPaletteItems', () => {
  it('returns all items unchanged for an empty query', () => {
    expect(rankPaletteItems('', items)).toEqual(items);
  });
  it('fuzzy-matches a subsequence', () => {
    const r = rankPaletteItems('gco', items).map(i => i.value);
    expect(r).toContain('git checkout'); // g..c..o subsequence
    expect(r).not.toContain('deploy {{env}}');
  });
  it('ranks a tighter match higher', () => {
    const r = rankPaletteItems('gre', items);
    expect(r[0].value).toBe('grep');
  });
  it('matches workflow labels too', () => {
    expect(rankPaletteItems('deploy', items).map(i => i.value)).toContain('deploy {{env}}');
  });
});
