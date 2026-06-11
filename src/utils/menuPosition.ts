export interface Point { x: number; y: number }
export interface Size { width: number; height: number }

const EDGE_PAD = 8;

/**
 * Keep a fixed-position menu fully inside the viewport: shift it up/left when
 * it would overflow the bottom/right edge, but never past the top-left pad.
 */
export function clampMenuPos(pos: Point, menu: Size, viewport: Size, pad = EDGE_PAD): Point {
  const x = Math.max(pad, Math.min(pos.x, viewport.width - menu.width - pad));
  const y = Math.max(pad, Math.min(pos.y, viewport.height - menu.height - pad));
  return { x, y };
}
