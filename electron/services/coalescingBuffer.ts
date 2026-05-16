type FlushFn = (chunk: string) => void;

export interface CoalescingBuffer {
  push(data: string): void;
  forceFlush(): void;
}

const MAX_CHUNK = 64 * 1024;

export function createCoalescingBuffer(flush: FlushFn): CoalescingBuffer {
  let pending = '';
  let scheduled = false;

  function doFlush() {
    if (pending.length === 0) {
      scheduled = false;
      return;
    }
    const slice = pending.slice(0, MAX_CHUNK);
    pending = pending.slice(MAX_CHUNK);
    flush(slice);
    if (pending.length > 0) {
      scheduled = true;
      setImmediate(doFlush);
    } else {
      scheduled = false;
    }
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
      while (pending.length > 0) {
        const slice = pending.slice(0, MAX_CHUNK);
        pending = pending.slice(MAX_CHUNK);
        flush(slice);
      }
      scheduled = false;
    },
  };
}
