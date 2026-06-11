export interface ScrollMetrics {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
}

/**
 * Warp-style auto-follow: the list only tracks new output while the user is
 * at (or within `slop` px of) the bottom. Scrolling up into history releases
 * the pin so streaming output never yanks the viewport away.
 */
export function isPinnedToBottom(m: ScrollMetrics, slop = 48): boolean {
  return m.scrollHeight - (m.scrollTop + m.clientHeight) <= slop;
}
