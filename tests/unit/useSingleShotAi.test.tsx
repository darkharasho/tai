// @vitest-environment jsdom
/**
 * Tests for useSingleShotAi hook.
 *
 * Mocks window.tai.ai with send/cancel/onMessage so the hook can be exercised
 * in a jsdom environment without a real Electron bridge.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSingleShotAi } from '@/hooks/useSingleShotAi';

// ---------- mock bridge helpers ----------

type MsgCallback = (msg: Record<string, unknown>) => void;

function makeBridge() {
  let storedCallback: MsgCallback | null = null;
  let removeListenerCalled = false;

  const onMessage = vi.fn((key: string, cb: MsgCallback) => {
    storedCallback = cb;
    return () => {
      removeListenerCalled = true;
      storedCallback = null;
    };
  });

  const send = vi.fn(() => Promise.resolve(true));
  const cancel = vi.fn();

  function fire(msg: Record<string, unknown>) {
    storedCallback?.(msg);
  }

  return { onMessage, send, cancel, fire, get listenerRemoved() { return removeListenerCalled; } };
}

function installBridge(bridge: ReturnType<typeof makeBridge>) {
  (window as unknown as Record<string, unknown>).tai = { ai: bridge };
}

function removeBridge() {
  delete (window as unknown as Record<string, unknown>).tai;
}

beforeEach(() => {
  removeBridge();
  vi.clearAllMocks();
});

// ---------- test 1: happy path — accumulates text and resolves on result ----------

describe('useSingleShotAi', () => {
  it('registers onMessage with the dedicated key, fires send, accumulates text, resolves on result', async () => {
    const bridge = makeBridge();
    installBridge(bridge);

    const { result } = renderHook(() =>
      useSingleShotAi('tab-1', { cwd: '/home/user', model: 'sonnet', effort: 'auto', permMode: 'ask' })
    );

    const controller = new AbortController();
    const promise = result.current('suggest something', controller.signal);

    // onMessage was called with the dedicated key.
    expect(bridge.onMessage).toHaveBeenCalledWith('tab-1::predict', expect.any(Function));

    // send was called with the dedicated key + correct params.
    expect(bridge.send).toHaveBeenCalledWith(
      'tab-1::predict',
      '/home/user',
      'suggest something',
      'ask',
      'sonnet',
      'auto'
    );

    // Drive the message accumulation: first an assistant delta, then a result.
    act(() => {
      bridge.fire({
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'git status', delta: true }],
        },
      });
    });

    act(() => {
      bridge.fire({ type: 'result' });
    });

    const text = await promise;
    expect(text).toBe('git status');

    // Listener must have been removed after settlement.
    expect(bridge.listenerRemoved).toBe(true);
  });

  // ---------- test 2: abort mid-flight → cancel called, resolves '' ----------

  it('cancels the provider and resolves "" when the signal is aborted mid-flight', async () => {
    const bridge = makeBridge();
    installBridge(bridge);

    const { result } = renderHook(() =>
      useSingleShotAi('tab-2', { cwd: '/tmp', model: 'sonnet' })
    );

    const controller = new AbortController();
    const promise = result.current('next cmd?', controller.signal);

    // No result yet — abort the signal.
    act(() => {
      controller.abort();
    });

    const text = await promise;
    expect(text).toBe('');
    expect(bridge.cancel).toHaveBeenCalledWith('tab-2::predict');

    // Listener must have been removed.
    expect(bridge.listenerRemoved).toBe(true);

    // Any subsequent messages don't re-settle (no throw expected).
    act(() => {
      bridge.fire({ type: 'result' });
    });
  });

  // ---------- test 3: window.tai absent → resolves '' without throwing ----------

  it('resolves "" without throwing when window.tai is absent', async () => {
    // Do NOT install a bridge.
    const { result } = renderHook(() =>
      useSingleShotAi('tab-3', { cwd: '/tmp', model: 'haiku' })
    );

    const controller = new AbortController();
    let text: string | undefined;
    let error: unknown;

    await act(async () => {
      try {
        text = await result.current('anything', controller.signal);
      } catch (e) {
        error = e;
      }
    });

    expect(error).toBeUndefined();
    expect(text).toBe('');
  });
});
