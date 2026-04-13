import { useState, useEffect, useCallback, useRef } from 'react';
import { version as currentVersion } from '../../package.json';

export type FetchStatus = 'idle' | 'loading' | 'success' | 'error';

export interface ReleaseEntry {
  version: string;
  notes: string;
}

export interface UseWhatsNewReturn {
  isOpen: boolean;
  version: string;
  releases: ReleaseEntry[];
  fetchStatus: FetchStatus;
  openWhatsNew: () => void;
  closeWhatsNew: () => void;
}

const RELEASES_URL = 'https://api.github.com/repos/darkharasho/tai/releases';

export function compareSemver(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map(Number);
  const pb = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function useWhatsNew(): UseWhatsNewReturn {
  const [isOpen, setIsOpen] = useState(false);
  const [releases, setReleases] = useState<ReleaseEntry[]>([]);
  const [fetchStatus, setFetchStatus] = useState<FetchStatus>('idle');
  const lastSeenRef = useRef<string | null>(null);

  const doFetch = useCallback((afterVersion: string | null) => {
    setFetchStatus('loading');
    setReleases([]);
    fetch(RELEASES_URL)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<Array<{ tag_name: string; body?: string; draft?: boolean; prerelease?: boolean }>>;
      })
      .then(data => {
        const entries = data
          .filter(r => !r.draft && !r.prerelease)
          .filter(r => {
            const ver = r.tag_name.replace(/^v/, '');
            const afterCurrent = compareSemver(ver, currentVersion) > 0;
            const beforeOrAtLastSeen = afterVersion != null && compareSemver(ver, afterVersion) <= 0;
            const isCurrentVersion = compareSemver(ver, currentVersion) === 0;
            return !afterCurrent && (isCurrentVersion || !beforeOrAtLastSeen) && (r.body ?? '').trim() !== '';
          })
          .sort((a, b) => compareSemver(b.tag_name, a.tag_name))
          .map(r => ({ version: r.tag_name.replace(/^v/, ''), notes: r.body ?? '' }));
        setReleases(entries);
        setFetchStatus('success');
      })
      .catch(() => setFetchStatus('error'));
  }, []);

  const openWhatsNew = useCallback(() => {
    window.tai.config.set('lastSeenVersion', currentVersion);
    setIsOpen(true);
    doFetch(lastSeenRef.current);
  }, [doFetch]);

  const closeWhatsNew = useCallback(() => setIsOpen(false), []);

  useEffect(() => {
    window.tai.config.get().then((config: any) => {
      const lastSeen = config?.lastSeenVersion ?? null;
      lastSeenRef.current = lastSeen;
      if (lastSeen !== currentVersion) {
        openWhatsNew();
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { isOpen, version: currentVersion, releases, fetchStatus, openWhatsNew, closeWhatsNew };
}
