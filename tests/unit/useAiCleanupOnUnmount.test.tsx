// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { useRef } from 'react';
import { useAiCleanupOnUnmount } from '@/hooks/useAiCleanupOnUnmount';

function Harness({ cleanup }: { cleanup: () => void }) {
  const ref = useRef<(() => void) | null>(cleanup);
  useAiCleanupOnUnmount('tab-1', ref);
  return null;
}

describe('useAiCleanupOnUnmount', () => {
  beforeEach(() => {
    (globalThis as any).window = (globalThis as any).window || {};
    (window as any).tai = { ai: { stop: vi.fn(), cancel: vi.fn() } };
  });

  it('invokes the cleanup ref and stops AI on unmount', () => {
    const cleanup = vi.fn();
    const { unmount } = render(<Harness cleanup={cleanup} />);
    unmount();
    expect(cleanup).toHaveBeenCalledOnce();
    expect((window as any).tai.ai.stop).toHaveBeenCalledWith('tab-1');
  });

  it('does not throw when cleanup ref is null', () => {
    const { unmount } = render(<NullHarness />);
    expect(() => unmount()).not.toThrow();
  });
});

function NullHarness() {
  const ref = useRef<(() => void) | null>(null);
  useAiCleanupOnUnmount('tab-1', ref);
  return null;
}
