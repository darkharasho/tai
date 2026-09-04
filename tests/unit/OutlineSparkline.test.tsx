// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { OutlineSparkline } from '@/components/OutlineSparkline';
import type { OutlineKind, SessionOutline } from '@/utils/sessionOutline';

function outline(kinds: OutlineKind[]): SessionOutline {
  return {
    entries: kinds.map((kind, i) => ({ id: `b${i}`, label: `cmd-${i}`, kind })),
    total: kinds.length,
    failed: kinds.filter(k => k === 'fail').length,
  };
}

/** CSS-module names are hashed, so match on the readable stem. */
const stems = (el: HTMLElement) =>
  [...el.querySelectorAll('i')].map(i =>
    i.className.split(/\s+/).filter(Boolean).map(c => c.split('_')[1]).join(' '));

describe('OutlineSparkline', () => {
  it('draws nothing for a session with no blocks', () => {
    const { container } = render(<OutlineSparkline outline={outline([])} />);
    expect(container.firstChild).toBeNull();
  });

  it('gives each mark its kind class', () => {
    const { container } = render(<OutlineSparkline outline={outline(['ok', 'fail', 'ai'])} />);
    expect(stems(container).map(s => s.split(' ')[0])).toEqual(['ok', 'fail', 'ai']);
  });

  // Without this the strip is inert: a successful command is by far the
  // commonest event and its mark is the quietest, so finishing one produced no
  // change you could see. The head is what moves when you work.
  it('marks only the newest entry as the head', () => {
    const { container } = render(<OutlineSparkline outline={outline(['ok', 'ok', 'ok'])} />);
    expect(stems(container).map(s => s.includes('head'))).toEqual([false, false, true]);
  });

  it('keeps the head on the last mark once the session is compressed', () => {
    const kinds = Array.from({ length: 400 }, (): OutlineKind => 'ok');
    const { container } = render(<OutlineSparkline outline={outline(kinds)} />);
    const marks = stems(container);
    expect(marks.length).toBeLessThan(kinds.length);
    expect(marks.filter(m => m.includes('head'))).toHaveLength(1);
    expect(marks[marks.length - 1]).toContain('head');
  });
});
