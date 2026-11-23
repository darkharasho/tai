import { useEffect, useState } from 'react';
import type { CodexModelOption } from '@/types';

export interface CodexModelCatalog {
  models: CodexModelOption[];
  /** The `model` set in ~/.codex/config.toml — what "Default" resolves to. */
  configModel: string | null;
}

const EMPTY: CodexModelCatalog = { models: [], configModel: null };
let pending: Promise<CodexModelCatalog> | null = null;

function load(): Promise<CodexModelCatalog> {
  if (!pending) {
    const fetcher = window.tai?.codex?.models;
    pending = fetcher
      ? fetcher().then((r) => ({ models: r?.models ?? [], configModel: r?.configModel ?? null })).catch(() => EMPTY)
      : Promise.resolve(EMPTY);
    // An empty result (CLI missing or not logged in yet) is retried next mount.
    pending.then((r) => { if (!r.models.length) pending = null; });
  }
  return pending;
}

/** Codex's model catalog, fetched from the CLI once per app session. */
export function useCodexModels(enabled = true): CodexModelCatalog {
  const [catalog, setCatalog] = useState<CodexModelCatalog>(EMPTY);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    load().then((r) => { if (live) setCatalog(r); });
    return () => { live = false; };
  }, [enabled]);
  return catalog;
}

/** Display name for a Codex model slug (falls back to the slug). */
export function codexModelLabel(catalog: CodexModelCatalog, slug: string | null | undefined): string | undefined {
  if (!slug) return undefined;
  return catalog.models.find((m) => m.value === slug)?.label ?? slug;
}
