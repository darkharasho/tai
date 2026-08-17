import { describe, it, expect } from 'vitest';
import { translateSdkMessage } from '../../electron/services/claudeSdkTranslate';

describe('translateSdkMessage', () => {
  it('assistant message → {type:assistant, message}', () => {
    const m = { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] } };
    expect(translateSdkMessage(m)).toEqual([{ type: 'assistant', message: m.message }]);
  });

  it('user (tool_result) message → {type:user, message}', () => {
    const m = { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } };
    expect(translateSdkMessage(m)).toEqual([{ type: 'user', message: m.message }]);
  });

  it('successful result → {type:result} then {type:done}', () => {
    const m = { type: 'result', subtype: 'success', result: 'done', total_cost_usd: 0.01 };
    expect(translateSdkMessage(m)).toEqual([{ type: 'result', content: m, result: 'done' }, { type: 'done' }]);
  });

  it('error result → {type:error} then {type:done}', () => {
    const m = { type: 'result', subtype: 'error_during_execution', result: 'boom' };
    const out = translateSdkMessage(m);
    expect(out[0].type).toBe('error');
    expect(out[0].text).toContain('boom');
    expect(out[1]).toEqual({ type: 'done' });
  });

  it('ignored message types → []', () => {
    expect(translateSdkMessage({ type: 'system', subtype: 'init' })).toEqual([]);
    expect(translateSdkMessage({ type: 'tool_progress' })).toEqual([]);
  });

  it('thinking_delta stream_event → delta-flagged thinking block', () => {
    const m = {
      type: 'stream_event',
      parent_tool_use_id: null,
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'thinking_delta', thinking: 'let me ' },
      },
    };
    expect(translateSdkMessage(m)).toEqual([
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'let me ', delta: true }] } },
    ]);
  });

  it('text_delta stream_event → delta-flagged text block', () => {
    const m = {
      type: 'stream_event',
      parent_tool_use_id: null,
      event: {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'text_delta', text: 'Hel' },
      },
    };
    expect(translateSdkMessage(m)).toEqual([
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Hel', delta: true }] } },
    ]);
  });

  it('drops sub-agent stream_events and non-delta stream events', () => {
    expect(translateSdkMessage({
      type: 'stream_event',
      parent_tool_use_id: 'toolu_1',
      event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'sub' } },
    })).toEqual([]);
    expect(translateSdkMessage({
      type: 'stream_event',
      parent_tool_use_id: null,
      event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    })).toEqual([]);
    expect(translateSdkMessage({
      type: 'stream_event',
      parent_tool_use_id: null,
      event: { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"a"' } },
    })).toEqual([]);
    expect(translateSdkMessage({
      type: 'stream_event',
      parent_tool_use_id: null,
      event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '' } },
    })).toEqual([]);
  });
});
