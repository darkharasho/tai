// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { useRef } from 'react';
import type { DisplayItem } from '@/components/BlockList';
import { useSudoCancelOnUnmount } from '@/hooks/useSudoCancelOnUnmount';

type SudoStatus = 'pending' | 'answered' | 'cancelled' | 'auto' | 'refused';
const sudo = (status: SudoStatus, requestId: string): DisplayItem =>
  ({ type: 'sudo', id: `s-${requestId}`, requestId, prompt: '', status });

function Harness({ items, latest }: { items: DisplayItem[]; latest?: DisplayItem[] }) {
  const ref = useRef<DisplayItem[]>(items);
  // Mirrors TerminalSession: the ref tracks the latest committed items.
  if (latest) ref.current = latest;
  useSudoCancelOnUnmount(ref);
  return null;
}

describe('useSudoCancelOnUnmount', () => {
  const sudoCancel = vi.fn();
  beforeEach(() => {
    sudoCancel.mockReset();
    (window as any).tai = { ai: { sudoCancel } };
  });

  it('cancels every pending sudo request when the tab unmounts', () => {
    const { unmount } = render(
      <Harness items={[sudo('pending', 'req-1'), sudo('answered', 'req-2'), sudo('pending', 'req-3')]} />,
    );
    expect(sudoCancel).not.toHaveBeenCalled();
    unmount();
    expect(sudoCancel.mock.calls).toEqual([['req-1'], ['req-3']]);
  });

  it('uses the items current at unmount, not at mount', () => {
    const { rerender, unmount } = render(<Harness items={[]} />);
    rerender(<Harness items={[]} latest={[sudo('pending', 'req-7')]} />);
    unmount();
    expect(sudoCancel.mock.calls).toEqual([['req-7']]);
  });

  it('does nothing when no sudo item is pending', () => {
    const { unmount } = render(<Harness items={[sudo('cancelled', 'req-1'), sudo('auto', '')]} />);
    unmount();
    expect(sudoCancel).not.toHaveBeenCalled();
  });

  it('does not throw without the preload API', () => {
    (window as any).tai = undefined;
    const { unmount } = render(<Harness items={[sudo('pending', 'req-1')]} />);
    expect(() => unmount()).not.toThrow();
  });
});
