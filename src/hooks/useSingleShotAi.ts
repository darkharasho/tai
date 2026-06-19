import { useCallback } from 'react';

/**
 * Returns a stable callback that fires a single-shot AI request on a DEDICATED
 * provider key (`${tabId}::predict`), isolated from the tab's real AI session.
 *
 * The returned function:
 * - Registers an onMessage listener, accumulates assistant text exactly like
 *   TerminalSession's real handler, and resolves on `result` / `done`.
 * - Handles abort signal: cancels the in-flight provider request and resolves ''.
 * - Settles exactly once via a `settled` guard; always removes the onMessage
 *   listener and the abort-signal listener on settlement.
 * - Guards all window.tai?.ai? access so it no-ops (resolves '') when the bridge
 *   is absent (e.g. unit tests that don't stub it).
 */
export function useSingleShotAi(
  tabId: string,
  opts: {
    cwd: string;
    model: string;
    effort?: string;
    permMode?: string;
  }
): (prompt: string, signal: AbortSignal) => Promise<string> {
  const { cwd, model, effort, permMode } = opts;

  return useCallback(
    (prompt: string, signal: AbortSignal): Promise<string> => {
      const predictKey = `${tabId}::predict`;

      // Fast exits when bridge absent or signal already fired.
      if (signal.aborted) return Promise.resolve('');
      if (!window.tai?.ai) return Promise.resolve('');

      return new Promise<string>((resolve) => {
        let settled = false;
        let accumulatedText = '';
        let removeListener: (() => void) | null = null;

        function settle(value: string) {
          if (settled) return;
          settled = true;
          // Remove the onMessage listener.
          removeListener?.();
          removeListener = null;
          // Remove our abort handler (noop if already fired).
          signal.removeEventListener('abort', onAbort);
          resolve(value);
        }

        // Message accumulator — mirrors TerminalSession's real handler.
        function onMsg(msg: Record<string, unknown>) {
          if (settled) return;

          if (msg.type === 'assistant' && msg.message) {
            const message = msg.message as Record<string, unknown>;
            const content = Array.isArray(message.content) ? message.content : [];
            for (const block of content) {
              if (block && typeof block === 'object') {
                const b = block as Record<string, unknown>;
                if (b.type === 'text' && typeof b.text === 'string' && b.text) {
                  if (b.delta) {
                    accumulatedText += b.text;
                  } else {
                    accumulatedText = b.text;
                  }
                }
              }
            }
          }

          if (msg.type === 'result' || msg.type === 'done' || msg.type === 'error') {
            settle(accumulatedText);
          }
        }

        function onAbort() {
          window.tai?.ai?.cancel(predictKey);
          settle('');
        }

        // Register listeners.
        removeListener = window.tai!.ai!.onMessage(predictKey, onMsg) ?? null;
        signal.addEventListener('abort', onAbort, { once: true });

        // Fire the request after listeners are in place.
        window.tai!.ai!.send(
          predictKey,
          cwd,
          prompt,
          permMode ?? 'ask',
          model,
          effort
        );
      });
    },
    // tabId, cwd, model, effort, permMode are all primitives — stable deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tabId, cwd, model, effort, permMode]
  );
}
