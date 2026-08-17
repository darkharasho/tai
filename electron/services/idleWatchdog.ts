// Kills a provider process that stops producing output without exiting, so the
// renderer never hangs in a "thinking" state forever.
export const IDLE_TIMEOUT_MS = 120_000;

export function createIdleWatchdog(opts: { idleMs?: number; onIdle: () => void }): {
  kick(): void;
  pause(): void;
  resume(): void;
  cancel(): void;
} {
  const idleMs = opts.idleMs ?? IDLE_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let fired = false;
  // Nested because several tools can await approval concurrently; the clock
  // only restarts once the last of them is answered.
  let pauses = 0;

  const clearTimer = () => {
    if (timer) { clearTimeout(timer); timer = null; }
  };

  const arm = () => {
    clearTimer();
    timer = setTimeout(() => {
      fired = true;
      timer = null;
      opts.onIdle();
    }, idleMs);
  };

  const cancel = () => {
    fired = true;
    clearTimer();
  };

  return {
    kick() {
      if (fired || pauses > 0) return;
      arm();
    },
    /** Stop the clock while output is legitimately blocked (e.g. awaiting a
     *  user's approval decision), which would otherwise look like a hang. */
    pause() {
      if (fired) return;
      pauses++;
      clearTimer();
    },
    resume() {
      if (fired) return;
      if (pauses > 0) pauses--;
      if (pauses === 0) arm();
    },
    cancel,
  };
}
