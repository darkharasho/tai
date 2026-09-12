// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { useRef } from 'react';
import { useSessionFocus } from '@/hooks/useSessionFocus';
import { SudoPrompt } from '@/components/SudoPrompt';
import type { InputSurface } from '@/utils/inputSurface';

const composer = { focus: vi.fn(), blur: vi.fn() };
const xterm = { focus: vi.fn() };

function Harness({ visible = true, surface, sudoPending }: { visible?: boolean; surface: InputSurface; sudoPending: boolean }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef(composer);
  const xtermRef = useRef(xterm);
  useSessionFocus({ visible, surface, aiNeedsInput: sudoPending, rootRef, composerRef, xtermRef });
  return (
    <div ref={rootRef}>
      {sudoPending && <SudoPrompt requestId="req-1" prompt="[sudo] password:" />}
    </div>
  );
}

const frames = () => act(() => new Promise<void>(r => setTimeout(r, 40)));
const field = () => document.querySelector<HTMLElement>('[data-testid="password-field"]');

beforeEach(() => {
  composer.focus.mockReset();
  composer.blur.mockReset();
  xterm.focus.mockReset();
  (window as any).tai = { ai: { sudoAnswer: vi.fn(), sudoCancel: vi.fn() } };
});
afterEach(() => cleanup());

describe('useSessionFocus', () => {
  it('a sudo prompt arriving while a TUI owns the xterm does not move focus to the xterm', async () => {
    const { rerender } = render(<Harness surface="fullscreen" sudoPending={false} />);
    await frames();
    expect(xterm.focus).toHaveBeenCalledTimes(1);
    xterm.focus.mockReset();

    rerender(<Harness surface="fullscreen" sudoPending />);
    await frames();
    expect(xterm.focus).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(field());
  });

  it('a sudo prompt arriving never pulls focus to the composer or blurs it', async () => {
    for (const surface of ['composer', 'tier1'] as const) {
      const { rerender, unmount } = render(<Harness surface={surface} sudoPending={false} />);
      await frames();
      composer.focus.mockReset();
      composer.blur.mockReset();
      rerender(<Harness surface={surface} sudoPending />);
      await frames();
      expect(composer.focus).not.toHaveBeenCalled();
      expect(composer.blur).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(field());
      unmount();
    }
  });

  it('switching to a tab with a pending sudo prompt focuses the password field', async () => {
    const { rerender } = render(<Harness visible={false} surface="composer" sudoPending />);
    await frames();
    field()!.blur();
    expect(document.activeElement).not.toBe(field());

    rerender(<Harness visible surface="composer" sudoPending />);
    await frames();
    expect(document.activeElement).toBe(field());
    expect(composer.focus).not.toHaveBeenCalled();
  });

  it('restores the surface focus once the sudo prompt resolves', async () => {
    const { rerender } = render(<Harness surface="fullscreen" sudoPending />);
    await frames();
    expect(xterm.focus).not.toHaveBeenCalled();
    rerender(<Harness surface="fullscreen" sudoPending={false} />);
    await frames();
    expect(xterm.focus).toHaveBeenCalledTimes(1);
  });
});
