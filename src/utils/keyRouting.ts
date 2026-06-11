export type KeyTarget = 'xterm' | 'input' | 'page';

/**
 * Who should handle a global key chord, given the event target?
 *  - xterm: the live terminal forwards raw keys itself — never double-handle.
 *  - input: single-line widgets (card stdin, password prompt) own their keys.
 *  - page:  everything else, including the composer textarea — the session
 *           handler acts (e.g. Ctrl+C → SIGINT to the foreground command).
 */
export function classifyKeyTarget(el: Element | EventTarget | null): KeyTarget {
  if (!(el instanceof Element)) return 'page';
  if (el.closest('.xterm')) return 'xterm';
  if (el instanceof HTMLInputElement) return 'input';
  return 'page';
}
