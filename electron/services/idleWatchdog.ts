// Kills a provider process that stops producing output without exiting, so the
// renderer never hangs in a "thinking" state forever.
export const IDLE_TIMEOUT_MS = 120_000;

export function createIdleWatchdog(opts: { idleMs?: number; onIdle: () => void }): {
  kick(): void;
  cancel(): void;
} {
  const idleMs = opts.idleMs ?? IDLE_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let fired = false;

  const cancel = () => {
    if (timer) { clearTimeout(timer); timer = null; }
  };

  return {
    kick() {
      if (fired) return;
      cancel();
      timer = setTimeout(() => {
        fired = true;
        timer = null;
        opts.onIdle();
      }, idleMs);
    },
    cancel,
  };
}
