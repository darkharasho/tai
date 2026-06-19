import { describe, it, expect } from 'vitest';
import { serializeWorkflows, deserializeWorkflows, MAX_WORKFLOWS } from '../../electron/services/workflowStore';

describe('workflowStore (de)serialize', () => {
  it('round-trips workflows', () => {
    const list = [{ id: '1', name: 'Deploy', command: 'deploy {{env}}' }];
    expect(deserializeWorkflows(serializeWorkflows(list))).toEqual(list);
  });
  it('returns [] for null/garbage', () => {
    expect(deserializeWorkflows(null)).toEqual([]);
    expect(deserializeWorkflows('{not json')).toEqual([]);
    expect(deserializeWorkflows('{"x":1}')).toEqual([]);
  });
  it('drops malformed entries and caps the list', () => {
    const big = Array.from({ length: MAX_WORKFLOWS + 10 }, (_, i) => ({ id: `${i}`, name: `w${i}`, command: 'x' }));
    expect(deserializeWorkflows(JSON.stringify(big)).length).toBe(MAX_WORKFLOWS);
    expect(deserializeWorkflows(JSON.stringify([{ id: 1 }, { id: 'ok', name: 'n', command: 'c' }])))
      .toEqual([{ id: 'ok', name: 'n', command: 'c' }]);
  });
});
