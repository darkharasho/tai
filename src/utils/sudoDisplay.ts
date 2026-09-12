import type { DisplayItem } from '@/components/BlockList';

export function hasPendingSudo(items: DisplayItem[]): boolean {
  return items.some(item => item.type === 'sudo' && item.status === 'pending');
}

/**
 * Apply a `sudo_resolved` message. A duplicate-claim refusal must always be
 * visible, so when there is no pending field to replace (the request was still
 * queued, holding for auto-fill, or already answered) a warning is appended.
 */
export function applySudoResolved(
  items: DisplayItem[],
  requestId: string,
  outcome: unknown,
  newId: () => string,
): DisplayItem[] {
  const status = outcome === 'cancelled' ? 'cancelled' as const
    : outcome === 'refused-duplicate' ? 'refused' as const
    : 'answered' as const;
  const hasPending = items.some(di => di.type === 'sudo' && di.requestId === requestId && di.status === 'pending');
  if (hasPending) {
    return items.map(di =>
      di.type === 'sudo' && di.requestId === requestId && di.status === 'pending' ? { ...di, status } : di
    );
  }
  if (status !== 'refused') return items;
  return [...items, { type: 'sudo' as const, id: newId(), requestId, prompt: '', status }];
}

/**
 * Local cancel for when the renderer stops the AI turn itself. The broker's
 * own `sudo_resolved cancelled` follows and is then a no-op; this makes sure a
 * dead field never lingers if that message is late or lost.
 */
export function cancelPendingSudo(items: DisplayItem[]): DisplayItem[] {
  if (!hasPendingSudo(items)) return items;
  return items.map(di =>
    di.type === 'sudo' && di.status === 'pending' ? { ...di, status: 'cancelled' as const } : di
  );
}
