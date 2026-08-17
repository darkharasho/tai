import { classifyProviderError } from '../../src/utils/classifyProviderError';

export type RendererMsg = { type: string; [k: string]: any };

/**
 * Translate one Claude Agent SDK output message into the renderer's existing
 * ai:message envelopes. Assistant/user messages carry standard Anthropic
 * content blocks the renderer already parses, so they pass through under the
 * same envelope. A final `result` is split into a result echo + a `done`.
 * Unknown / progress / system messages are dropped.
 *
 * `stream_event` carries the incremental text/thinking deltas (only emitted
 * when `includePartialMessages` is set). They are re-wrapped as assistant
 * content blocks flagged `delta: true` so the renderer appends them; the
 * complete assistant message that follows repeats the same text and is
 * deduped there against the already-accumulated entry.
 */
export function translateSdkMessage(msg: any): RendererMsg[] {
  if (!msg || typeof msg !== 'object') return [];
  switch (msg.type) {
    case 'stream_event': {
      // Sub-agent (Task) output streams under a parent tool id; it belongs to
      // that tool's card rather than the main answer, so it is dropped here.
      if (msg.parent_tool_use_id) return [];
      const delta = msg.event?.type === 'content_block_delta' ? msg.event.delta : null;
      if (!delta) return [];
      if (delta.type === 'thinking_delta' && delta.thinking) {
        return [{ type: 'assistant', message: { role: 'assistant', content: [{ type: 'thinking', thinking: delta.thinking, delta: true }] } }];
      }
      if (delta.type === 'text_delta' && delta.text) {
        return [{ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: delta.text, delta: true }] } }];
      }
      return [];
    }
    case 'assistant':
      return msg.message ? [{ type: 'assistant', message: msg.message }] : [];
    case 'user':
      return msg.message ? [{ type: 'user', message: msg.message }] : [];
    case 'result': {
      if (msg.subtype && msg.subtype !== 'success') {
        const text = typeof msg.result === 'string' ? msg.result : `AI error (${msg.subtype})`;
        const { category } = classifyProviderError(text);
        return [{ type: 'error', text, category }, { type: 'done' }];
      }
      return [{ type: 'result', content: msg, result: (msg as any).result ?? '' }, { type: 'done' }];
    }
    default:
      return [];
  }
}
