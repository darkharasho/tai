export interface ResizeQueue {
  enqueue(cols: number, rows: number): void;
}

type ApplyFn = (cols: number, rows: number) => void;

export function createResizeQueue(apply: ApplyFn): ResizeQueue {
  // next: the geometry that will be applied on the very next drain tick.
  // pending: the latest geometry that arrived after next was locked in
  //          (last-write-wins; applied after next completes).
  let next: { cols: number; rows: number } | null = null;
  let pending: { cols: number; rows: number } | null = null;
  let inFlight = false;

  function drain() {
    if (!next) {
      inFlight = false;
      return;
    }
    const { cols, rows } = next;
    // Promote pending → next for the following tick.
    next = pending;
    pending = null;
    apply(cols, rows);
    // Re-check on next tick in case there is a pending item or a new enqueue.
    setImmediate(drain);
  }

  return {
    enqueue(cols: number, rows: number) {
      if (!inFlight) {
        // First enqueue in a new cycle: schedule it as `next`.
        next = { cols, rows };
        pending = null;
        inFlight = true;
        setImmediate(drain);
      } else if (next === null) {
        // A drain tick is scheduled but hasn't fired yet and next is empty
        // (e.g. first item was just consumed). Promote this as next so drain
        // picks it up on the already-scheduled tick.
        next = { cols, rows };
      } else {
        // next is already set; this is an additional enqueue — last-write-wins.
        pending = { cols, rows };
      }
    },
  };
}
