// tests/unit/workflows.test.ts
import { describe, it, expect } from 'vitest';
import { parseParams, substituteParams } from '@/utils/workflows';

describe('workflow params', () => {
  it('extracts ordered unique params', () => {
    expect(parseParams('deploy {{env}} --tag {{tag}} to {{env}}')).toEqual(['env', 'tag']);
  });
  it('returns empty for a param-less command', () => {
    expect(parseParams('git status')).toEqual([]);
  });
  it('substitutes provided values', () => {
    expect(substituteParams('deploy {{env}}', { env: 'prod' })).toBe('deploy prod');
  });
  it('leaves missing params as the literal placeholder', () => {
    expect(substituteParams('deploy {{env}} {{tag}}', { env: 'prod' })).toBe('deploy prod {{tag}}');
  });
  it('replaces every occurrence of a repeated param', () => {
    expect(substituteParams('{{x}} and {{x}}', { x: '1' })).toBe('1 and 1');
  });
});
