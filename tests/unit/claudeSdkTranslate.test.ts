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
});
