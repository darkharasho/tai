export type ExitClass = 'success' | 'failure' | 'neutral' | 'unknown';

// Warp parity: Ctrl-C (130) and SIGPIPE (141) are user actions / plumbing,
// not command failures, so they never get failure styling. Any signal
// termination is likewise neutral.
const NEUTRAL_EXITS = new Set([130, 141]);

export function classifyExit(exitCode?: number, signal?: string | null): ExitClass {
  if (signal) return 'neutral';
  if (exitCode === undefined) return 'unknown';
  if (exitCode === 0) return 'success';
  if (NEUTRAL_EXITS.has(exitCode)) return 'neutral';
  return 'failure';
}
