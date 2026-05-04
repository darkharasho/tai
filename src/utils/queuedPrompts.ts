export type QueuedPrompt = {
  id: string;
  text: string;
};

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function addQueuedPrompt(queue: QueuedPrompt[], text: string): QueuedPrompt[] {
  const trimmed = text.trim();
  if (!trimmed) return queue;
  return [...queue, { id: newId(), text: trimmed }];
}

export function editQueuedPrompt(
  queue: QueuedPrompt[],
  id: string,
  text: string,
): QueuedPrompt[] {
  const trimmed = text.trim();
  if (!trimmed) return removeQueuedPrompt(queue, id);
  return queue.map(q => (q.id === id ? { ...q, text: trimmed } : q));
}

export function removeQueuedPrompt(queue: QueuedPrompt[], id: string): QueuedPrompt[] {
  return queue.filter(q => q.id !== id);
}

export function joinQueuedPrompts(queue: QueuedPrompt[]): string {
  return queue.map(q => q.text).join('\n\n');
}
