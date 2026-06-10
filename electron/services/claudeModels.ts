import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface ClaudeModelOption {
  value: string;        // tai's CustomDropdown keys on `value` (CLI --model alias or id)
  label: string;
  description?: string;
  recommended?: boolean;
  oneM?: boolean;
  extra?: boolean;
}

// Offline fallback, used when claude:models can't detect the account's allowed
// set (e.g. not logged in). Labels carry the current lineup versions.
export const BASE_CLAUDE_MODELS: ClaudeModelOption[] = [
  { value: 'default',    label: 'Default',                 recommended: true },
  { value: 'best',       label: 'Best' },
  { value: 'opus',       label: 'Opus 4.8' },
  { value: 'opus[1m]',   label: 'Opus 4.8 (1M context)',   oneM: true },
  { value: 'sonnet',     label: 'Sonnet 4.6' },
  { value: 'sonnet[1m]', label: 'Sonnet 4.6 (1M context)', oneM: true },
  { value: 'haiku',      label: 'Haiku 4.5' },
  { value: 'opusplan',   label: 'Opus Plan' },
];

function readClaudeUserConfig(): any {
  try {
    return JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude.json'), 'utf8'));
  } catch {
    return null;
  }
}

// Derives the models actually available to this account/org rather than assuming
// every model is allowed. The Claude CLI has no "list models" command, but it
// caches the relevant signals in ~/.claude.json:
//   - additionalModelOptionsCache: account-specific extra models (e.g. Fable)
//   - s1mAccessCache[orgUuid].hasAccess: whether the org can use 1M context
//   - oauthAccount.organizationUuid: the key into s1mAccessCache
// When not logged in (no cache) we fall back to the built-in set.
export function deriveClaudeModels(cfg: any): { models: ClaudeModelOption[]; detected: boolean } {
  if (!cfg || !cfg.oauthAccount) {
    return { models: BASE_CLAUDE_MODELS, detected: false };
  }

  const orgUuid: string | undefined = cfg.oauthAccount.organizationUuid;
  const has1m = !!(orgUuid && cfg.s1mAccessCache?.[orgUuid]?.hasAccess === true);

  const byValue = new Map(BASE_CLAUDE_MODELS.map(m => [m.value, m]));
  const pick = (v: string) => byValue.get(v)!;

  const models: ClaudeModelOption[] = [pick('default'), pick('best')];

  const extras = Array.isArray(cfg.additionalModelOptionsCache) ? cfg.additionalModelOptionsCache : [];
  for (const m of extras) {
    if (m && typeof m.value === 'string') {
      models.push({
        value: m.value,
        label: typeof m.label === 'string' && m.label ? m.label : m.value,
        description: typeof m.description === 'string' ? m.description : undefined,
        extra: true,
        oneM: m.value.includes('[1m]'),
      });
    }
  }

  models.push(pick('opus'));
  if (has1m) models.push(pick('opus[1m]'));
  models.push(pick('sonnet'));
  if (has1m) models.push(pick('sonnet[1m]'));
  models.push(pick('haiku'));
  models.push(pick('opusplan'));

  return { models, detected: true };
}

export function getAvailableClaudeModels(): { models: ClaudeModelOption[]; detected: boolean } {
  return deriveClaudeModels(readClaudeUserConfig());
}
