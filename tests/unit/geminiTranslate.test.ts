import { describe, it, expect, vi } from 'vitest';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  BrowserWindow: vi.fn(),
}));

vi.mock('node:os', () => ({ default: { homedir: () => '/home/test' } }));
vi.mock('node:path', async () => {
  const actual = await vi.importActual<typeof import('path')>('path');
  return { default: actual };
});
vi.mock('node:fs', () => ({
  default: { existsSync: () => false, readdirSync: () => [] },
}));
vi.mock('./gemini-acp', () => ({
  createGeminiAcpClient: vi.fn(),
}));

import { translateGeminiEvent } from '../../electron/services/gemini';

describe('translateGeminiEvent', () => {
  const projectPath = '/tmp/test-project';

  it('translates session/update agent_message_chunk to delta text', () => {
    const result = translateGeminiEvent({
      method: 'session/update',
      params: { update: { sessionUpdate: 'agent_message_chunk', content: { text: 'Hello' } } },
    }, projectPath);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('assistant');
    expect(result!.message.content[0]).toMatchObject({ type: 'text', text: 'Hello', delta: true });
  });

  it('translates session/update tool_call to tool_use', () => {
    const result = translateGeminiEvent({
      method: 'session/update',
      params: { update: { sessionUpdate: 'tool_call', toolCallId: 'tc-1', title: 'ReadFile', kind: 'read', locations: ['/tmp/foo'] } },
    }, projectPath);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('assistant');
    expect(result!.message.content[0]).toMatchObject({
      id: 'tc-1',
      type: 'tool_use',
      name: 'ReadFile',
    });
  });

  it('translates session/update tool_call_update to tool_result', () => {
    const result = translateGeminiEvent({
      method: 'session/update',
      params: { update: { sessionUpdate: 'tool_call_update', toolCallId: 'tc-1', content: [{ type: 'content', content: { type: 'text', text: 'file contents' } }], status: 'completed' } },
    }, projectPath);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('user');
    expect(result!.message.content[0]).toMatchObject({
      type: 'tool_result',
      tool_use_id: 'tc-1',
      is_error: false,
    });
  });

  it('marks failed tool_call_update as error', () => {
    const result = translateGeminiEvent({
      method: 'session/update',
      params: { update: { sessionUpdate: 'tool_call_update', toolCallId: 'tc-1', content: [], status: 'failed' } },
    }, projectPath);
    expect(result!.message.content[0].is_error).toBe(true);
  });

  it('translates tool/call to tool_use', () => {
    const result = translateGeminiEvent({
      method: 'tool/call',
      params: { id: 'tc-2', name: 'Bash', input: { command: 'ls' } },
    }, projectPath);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('assistant');
    expect(result!.message.content[0]).toMatchObject({
      id: 'tc-2',
      type: 'tool_use',
      name: 'Bash',
      input: { command: 'ls' },
    });
  });

  it('translates tool/result to tool_result', () => {
    const result = translateGeminiEvent({
      method: 'tool/result',
      params: { id: 'tc-2', output: 'file.txt', isError: false },
    }, projectPath);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('user');
    expect(result!.message.content[0]).toMatchObject({
      type: 'tool_result',
      tool_use_id: 'tc-2',
      content: 'file.txt',
      is_error: false,
    });
  });

  it('translates message/assistant to text', () => {
    const result = translateGeminiEvent({
      method: 'message/assistant',
      params: { text: 'Here is the answer', delta: false },
    }, projectPath);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('assistant');
    expect(result!.message.content[0]).toMatchObject({ type: 'text', text: 'Here is the answer', delta: false });
  });

  it('returns null for unknown event methods', () => {
    expect(translateGeminiEvent({ method: 'unknown/event' }, projectPath)).toBeNull();
  });
});
