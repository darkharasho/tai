type FlushFn = (chunk: string) => void;

export interface CoalescingBuffer {
  push(data: string): void;
  forceFlush(): void;
}

export function createCoalescingBuffer(flush: FlushFn): CoalescingBuffer {
  let pending = '';
  let scheduled = false;

  function doFlush() {
    scheduled = false;
    if (pending.length === 0) return;
    const out = pending;
    pending = '';
    flush(out);
  }

  return {
    push(data: string) {
      pending += data;
      if (!scheduled) {
        scheduled = true;
        setImmediate(doFlush);
      }
    },
    forceFlush() {
      doFlush();
    },
  };
}
