import { describe, it, expect } from 'vitest';
import { classifyProviderError } from '@/utils/classifyProviderError';

describe('classifyProviderError', () => {
  it('detects auth errors', () => {
    expect(classifyProviderError('Error: 401 Unauthorized').category).toBe('auth');
    expect(classifyProviderError('invalid api key').category).toBe('auth');
  });
  it('detects rate limits', () => {
    expect(classifyProviderError('429 Too Many Requests').category).toBe('rate-limit');
  });
  it('detects network errors', () => {
    expect(classifyProviderError('ECONNREFUSED').category).toBe('network');
  });
  it('falls back to unknown', () => {
    expect(classifyProviderError('something else').category).toBe('unknown');
  });
});
