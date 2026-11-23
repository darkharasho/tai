import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface CodexModelOption {
  value: string;          // model slug passed to `codex exec -m`
  label: string;
  description?: string;
  efforts?: string[];     // reasoning levels the model accepts
  defaultEffort?: string;
}

// Turns the catalog printed by `codex debug models` (same shape as
// ~/.codex/models_cache.json) into picker options: only models the Codex UI
// itself lists (visibility "list"), in the catalog's priority order.
export function parseCodexModelCatalog(raw: any): CodexModelOption[] {
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.models) ? raw.models : [];
  return list
    .filter((m: any) => m && typeof m.slug === 'string' && m.visibility === 'list')
    .sort((a: any, b: any) => (a.priority ?? 0) - (b.priority ?? 0))
    .map((m: any): CodexModelOption => ({
      value: m.slug,
      label: typeof m.display_name === 'string' && m.display_name ? m.display_name : m.slug,
      description: typeof m.description === 'string' ? m.description : undefined,
      efforts: Array.isArray(m.supported_reasoning_levels)
        ? m.supported_reasoning_levels
            .map((r: any) => (typeof r === 'string' ? r : r?.effort))
            .filter((r: any) => typeof r === 'string')
        : undefined,
      defaultEffort: typeof m.default_reasoning_level === 'string' ? m.default_reasoning_level : undefined,
    }));
}

/** The `model = "..."` line from ~/.codex/config.toml: what "Default" means. */
export function readCodexConfigModel(toml: string): string | null {
  // Only top-level keys count; stop at the first [table] header.
  for (const line of toml.split('\n')) {
    if (/^\s*\[/.test(line)) break;
    const m = line.match(/^\s*model\s*=\s*"([^"]+)"/);
    if (m) return m[1];
  }
  return null;
}

export function getCodexModels(binary: string, env: Record<string, string>): Promise<{ models: CodexModelOption[]; configModel: string | null; detected: boolean }> {
  let configModel: string | null = null;
  try {
    configModel = readCodexConfigModel(fs.readFileSync(path.join(os.homedir(), '.codex', 'config.toml'), 'utf8'));
  } catch { /* no config */ }
  return new Promise((resolve) => {
    execFile(binary, ['debug', 'models'], { env, timeout: 15000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
      if (err) return resolve({ models: [], configModel, detected: false });
      try {
        const models = parseCodexModelCatalog(JSON.parse(stdout));
        resolve({ models, configModel, detected: models.length > 0 });
      } catch {
        resolve({ models: [], configModel, detected: false });
      }
    });
  });
}
