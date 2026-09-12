import { useEffect, type MutableRefObject } from 'react';
import type { DisplayItem } from '@/components/BlockList';

/** Tell the main process to cancel every pending AI sudo request in `items`. */
export function cancelPendingSudoRequests(items: DisplayItem[]): void {
  for (const item of items) {
    if (item.type === 'sudo' && item.status === 'pending') {
      window.tai?.ai?.sudoCancel?.(item.requestId);
    }
  }
}

// On tab close, a pending AI sudo field would leave sudo (and the askpass
// broker) waiting for the full prompt timeout. Cancel each pending request.
export function useSudoCancelOnUnmount(itemsRef: MutableRefObject<DisplayItem[]>): void {
  useEffect(() => {
    return () => cancelPendingSudoRequests(itemsRef.current);
  }, [itemsRef]);
}
