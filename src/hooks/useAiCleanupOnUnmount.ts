import { useEffect, type MutableRefObject } from 'react';

// On tab close, an in-flight AI request leaks its IPC listener and child
// process. Drop the listener and stop the provider when the tab unmounts.
export function useAiCleanupOnUnmount(
  tabId: string,
  cleanupRef: MutableRefObject<(() => void) | null>,
): void {
  useEffect(() => {
    return () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
      window.tai?.ai?.stop?.(tabId);
    };
  }, [tabId, cleanupRef]);
}
