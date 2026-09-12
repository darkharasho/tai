import { useEffect, type MutableRefObject } from 'react';
import type { DisplayItem } from '@/components/BlockList';

// On tab close, a pending AI sudo field would leave sudo (and the askpass
// broker) waiting for the full prompt timeout. Cancel each pending request.
export function useSudoCancelOnUnmount(itemsRef: MutableRefObject<DisplayItem[]>): void {
  useEffect(() => {
    return () => {
      for (const item of itemsRef.current) {
        if (item.type === 'sudo' && item.status === 'pending') {
          window.tai?.ai?.sudoCancel?.(item.requestId);
        }
      }
    };
  }, [itemsRef]);
}
