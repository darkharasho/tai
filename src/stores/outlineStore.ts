import type { SessionOutline } from '@/utils/sessionOutline';

export interface OutlinePublication {
  outline: SessionOutline;
  /** The block currently filling the viewport, or null when nothing is. */
  currentId: string | null;
  /** Scroll that block into view and flash it — TerminalSession's own
      find-navigate, so a sidebar click lands exactly where Cmd+F does. */
  navigate: (itemId: string) => void;
}

/**
 * Block outlines, keyed by tab, published out of TerminalSession and read by
 * TabSidebar.
 *
 * A module store rather than App state on purpose: App keeps every tab
 * mounted (inactive ones are `display: none`), so holding outline state up
 * there would re-render every TerminalSession on every keystroke of output.
 * Here only the sidebar subscribes, so only the sidebar re-renders.
 */
const publications = new Map<string, OutlinePublication>();
const listeners = new Set<() => void>();

/** Snapshot for useSyncExternalStore: a counter, since the Map is mutable. */
let version = 0;

function emit(): void {
  version++;
  for (const listener of listeners) listener();
}

export function subscribeOutlines(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function getOutlineVersion(): number {
  return version;
}

export function getOutline(tabId: string): OutlinePublication | undefined {
  return publications.get(tabId);
}

export function publishOutline(tabId: string, publication: OutlinePublication): void {
  publications.set(tabId, publication);
  emit();
}

export function clearOutline(tabId: string): void {
  if (publications.delete(tabId)) emit();
}

/** Test seam: drops every publication without notifying. */
export function resetOutlines(): void {
  publications.clear();
  version = 0;
}
