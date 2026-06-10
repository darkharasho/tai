import { describe, it, expect } from 'vitest';
import { deriveClaudeModels, BASE_CLAUDE_MODELS } from '../../electron/services/claudeModels';

const ORG = '0bd5376b-34e3-414d-ba59-be2613bfac1a';

describe('deriveClaudeModels', () => {
  it('returns the base list (detected:false) when config is null', () => {
    expect(deriveClaudeModels(null)).toEqual({ models: BASE_CLAUDE_MODELS, detected: false });
  });

  it('returns the base list when there is no oauthAccount', () => {
    expect(deriveClaudeModels({ s1mAccessCache: {} })).toEqual({ models: BASE_CLAUDE_MODELS, detected: false });
  });

  it('omits 1M variants when the org lacks 1M access', () => {
    const { models, detected } = deriveClaudeModels({
      oauthAccount: { organizationUuid: ORG },
      s1mAccessCache: { [ORG]: { hasAccess: false } },
    });
    expect(detected).toBe(true);
    const values = models.map(m => m.value);
    expect(values).not.toContain('opus[1m]');
    expect(values).not.toContain('sonnet[1m]');
    expect(values).toContain('opus');
    expect(values).toContain('sonnet');
  });

  it('includes 1M variants when the org has 1M access', () => {
    const { models } = deriveClaudeModels({
      oauthAccount: { organizationUuid: ORG },
      s1mAccessCache: { [ORG]: { hasAccess: true } },
    });
    const values = models.map(m => m.value);
    expect(values).toContain('opus[1m]');
    expect(values).toContain('sonnet[1m]');
  });

  it('appends account-specific extra models with extra:true', () => {
    const { models } = deriveClaudeModels({
      oauthAccount: { organizationUuid: ORG },
      additionalModelOptionsCache: [{ value: 'claude-fable-5', label: 'Fable 5', description: 'Experimental' }],
    });
    const fable = models.find(m => m.value === 'claude-fable-5');
    expect(fable).toMatchObject({ value: 'claude-fable-5', label: 'Fable 5', description: 'Experimental', extra: true, oneM: false });
  });

  it('flags an extra model as oneM when its value contains [1m]', () => {
    const { models } = deriveClaudeModels({
      oauthAccount: { organizationUuid: ORG },
      additionalModelOptionsCache: [{ value: 'claude-fable-5[1m]' }],
    });
    expect(models.find(m => m.value === 'claude-fable-5[1m]')).toMatchObject({ extra: true, oneM: true, label: 'claude-fable-5[1m]' });
  });

  it('falls back to value for label and undefined description on a bare extra model', () => {
    const { models } = deriveClaudeModels({
      oauthAccount: { organizationUuid: ORG },
      additionalModelOptionsCache: [{ value: 'claude-fable-5', label: '' }],
    });
    const fable = models.find(m => m.value === 'claude-fable-5');
    expect(fable).toMatchObject({ value: 'claude-fable-5', label: 'claude-fable-5', extra: true });
    expect(fable?.description).toBeUndefined();
  });

  it('ignores a non-array additionalModelOptionsCache and treats the org as detected', () => {
    const { models, detected } = deriveClaudeModels({
      oauthAccount: { organizationUuid: ORG },
      additionalModelOptionsCache: 'not-an-array',
    });
    expect(detected).toBe(true);
    expect(models.every(m => !m.extra)).toBe(true);
  });

  it('treats a missing s1mAccessCache as no 1M access', () => {
    const { models } = deriveClaudeModels({ oauthAccount: { organizationUuid: ORG } });
    const values = models.map(m => m.value);
    expect(values).not.toContain('opus[1m]');
    expect(values).not.toContain('sonnet[1m]');
  });
});
