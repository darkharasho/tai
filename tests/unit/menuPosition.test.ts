import { describe, it, expect } from 'vitest';
import { clampMenuPos } from '@/utils/menuPosition';

const viewport = { width: 1024, height: 768 };
const menu = { width: 200, height: 180 };

describe('clampMenuPos', () => {
  it('leaves positions alone when the menu fits', () => {
    expect(clampMenuPos({ x: 100, y: 100 }, menu, viewport)).toEqual({ x: 100, y: 100 });
  });

  it('pulls the menu up when it would overflow the bottom edge', () => {
    expect(clampMenuPos({ x: 100, y: 760 }, menu, viewport)).toEqual({ x: 100, y: 768 - 180 - 8 });
  });

  it('pulls the menu left when it would overflow the right edge', () => {
    expect(clampMenuPos({ x: 1000, y: 100 }, menu, viewport)).toEqual({ x: 1024 - 200 - 8, y: 100 });
  });

  it('clamps both axes in a corner', () => {
    expect(clampMenuPos({ x: 1020, y: 766 }, menu, viewport)).toEqual({ x: 816, y: 580 });
  });

  it('never goes past the top-left padding', () => {
    expect(clampMenuPos({ x: 2, y: 2 }, { width: 2000, height: 2000 }, viewport)).toEqual({ x: 8, y: 8 });
  });
});
