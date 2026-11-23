import { describe, it, expect } from 'vitest';
import { parseCodexModelCatalog, readCodexConfigModel } from '../../electron/services/codexModels';
import { buildCodexArgs } from '../../electron/services/codex';

// Shape of `codex debug models` output from codex-cli 0.147 (trimmed).
const CATALOG = {
  models: [
    { slug: 'gpt-reserve', display_name: 'GPT-Reserve', visibility: 'hide', priority: 1, default_reasoning_level: 'medium', supported_reasoning_levels: ['low', 'medium'] },
    { slug: 'gpt-5.6-luna', display_name: 'GPT-5.6-Luna', description: 'Fast.', visibility: 'list', priority: 4, default_reasoning_level: 'medium', supported_reasoning_levels: [{ effort: 'low' }, { effort: 'high' }] },
    { slug: 'gpt-5.6-sol', display_name: 'GPT-5.6-Sol', visibility: 'list', priority: 2, default_reasoning_level: 'low', supported_reasoning_levels: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'] },
    { slug: 'codex-auto-review', display_name: 'Codex Auto Review', visibility: 'hide', priority: 5 },
  ],
};

describe('parseCodexModelCatalog', () => {
  it('keeps listed models in priority order', () => {
    const models = parseCodexModelCatalog(CATALOG);
    expect(models.map(m => m.value)).toEqual(['gpt-5.6-sol', 'gpt-5.6-luna']);
    expect(models[0]).toMatchObject({ label: 'GPT-5.6-Sol', defaultEffort: 'low', efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'] });
    expect(models[1]).toMatchObject({ description: 'Fast.', efforts: ['low', 'high'] });
  });

  it('returns nothing for junk', () => {
    expect(parseCodexModelCatalog(null)).toEqual([]);
    expect(parseCodexModelCatalog({ models: 'x' })).toEqual([]);
  });
});

describe('readCodexConfigModel', () => {
  it('reads the top-level model and ignores tables', () => {
    expect(readCodexConfigModel('model = "gpt-5.6-terra"\nmodel_reasoning_effort = "medium"\n')).toBe('gpt-5.6-terra');
    expect(readCodexConfigModel('[profiles.x]\nmodel = "o3"\n')).toBeNull();
    expect(readCodexConfigModel('')).toBeNull();
  });
});

describe('buildCodexArgs effort', () => {
  it('passes the reasoning effort as a config override', () => {
    const args = buildCodexArgs({ sessionId: 's1', model: 'gpt-5.6-sol', permMode: 'auto', message: 'hi', effort: 'high' });
    expect(args).toEqual(['exec', 'resume', '--json', '--skip-git-repo-check', '-m', 'gpt-5.6-sol',
      '-c', 'model_reasoning_effort="high"', '-c', 'sandbox_mode="workspace-write"', '--', 's1', 'hi']);
  });

  it('omits empty or malformed effort', () => {
    expect(buildCodexArgs({ sessionId: null, model: '', permMode: 'auto', message: 'hi', effort: '' })).not.toContain('-m');
    expect(buildCodexArgs({ sessionId: null, model: '', permMode: 'auto', message: 'hi', effort: 'x"; y' }).join(' ')).not.toContain('model_reasoning_effort');
  });
});
