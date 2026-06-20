import { classifyProviderError } from '../../src/utils/classifyProviderError';

export type RendererMsg = { type: string; [k: string]: any };

/**
 * Translate one Claude Agent SDK output message into the renderer's existing
 * ai:message envelopes. Assistant/user messages carry standard Anthropic
 * content blocks the renderer already parses, so they pass through under the
 * same envelope. A final `result` is split into a result echo + a `done`.
 * Unknown / progress / system messages are dropped.
 */
export function translateSdkMessage(msg: any): RendererMsg[] {
  if (!msg || typeof msg !== 'object') return [];
  switch (msg.type) {
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
