// Warp caps persisted blocks at 100; we keep a larger live budget since this
// is in-memory scrollback, evicting oldest so the newest history always shows.
export const MAX_SESSION_BLOCKS = 500;

export function capDisplayItems<T>(items: T[], max: number = MAX_SESSION_BLOCKS): T[] {
  if (items.length <= max) return items;
  return items.slice(items.length - max);
}
