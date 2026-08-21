import { describe, it, expect } from 'vitest';
import { renderGlyph } from '../../scripts/icon-source.mjs';

/** `viewBox="x y w h"` → numbers. */
function viewBox(svg: string): [number, number, number, number] {
  const m = svg.match(/viewBox="([-\d. ]+)"/);
  if (!m) throw new Error('no viewBox');
  return m[1].trim().split(/\s+/).map(Number) as [number, number, number, number];
}

// The chevrons span x 39..161 / y 39..161 once stroked, on the 200-unit grid.
const MARK = 122;

describe('renderGlyph', () => {
  it('insets the mark instead of cropping flush to it', () => {
    const [, , w, h] = viewBox(renderGlyph({ color: '#000' }));
    expect(w).toBe(h);
    // Flush would be exactly MARK; a panel icon needs room around it or it
    // reads oversized next to its neighbours.
    expect(w).toBeGreaterThan(MARK);
    expect(MARK / w).toBeCloseTo(0.74, 2);
  });

  it('centres the mark in the padded canvas', () => {
    const [x, y, w, h] = viewBox(renderGlyph({ color: '#000' }));
    expect(x + w / 2).toBeCloseTo(100, 6);
    expect(y + h / 2).toBeCloseTo(100, 6);
  });

  it('paints both chevrons in one colour by default, for macOS templates', () => {
    const svg = renderGlyph({ color: '#FFFFFF' });
    expect(svg).not.toContain('linearGradient');
    expect(svg.match(/stroke="#FFFFFF"/g)).toHaveLength(2);
  });

  it('gives the second chevron the spectrum gradient in accent mode', () => {
    const svg = renderGlyph({ color: '#1F1F1E', accent: true });
    expect(svg).toContain('linearGradient id="accent"');
    expect(svg).toContain('stroke="#1F1F1E"');
    expect(svg).toContain('stroke="url(#accent)"');
  });
});
