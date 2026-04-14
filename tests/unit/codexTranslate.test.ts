import { describe, it, expect, vi } from 'vitest';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  BrowserWindow: vi.fn(),
}));

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
vi.mock('node:os', () => ({ default: { homedir: () => '/home/test' } }));
vi.mock('node:fs', () => ({
  default: { existsSync: () => false, readdirSync: () => [] },
}));

import { translateCodexEvent } from '../../electron/services/codex';

describe('translateCodexEvent', () => {
  const projectPath = '/tmp/test-project';

  it('translates thread.started to session_id', () => {
    const events = translateCodexEvent(
      { type: 'thread.started', thread_id: 'thread-123' },
      projectPath,
    );
    expect(events).toEqual([
      { type: 'session_id', sessionId: 'thread-123', projectPath },
    ]);
  });

  it('translates item.started command_execution to tool_use Bash', () => {
    const events = translateCodexEvent(
      { type: 'item.started', item: { type: 'command_execution', id: 'tool-1', command: 'ls -la' } },
      projectPath,
    );
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('assistant');
    expect(events[0].message.content[0]).toMatchObject({
      id: 'tool-1',
      type: 'tool_use',
      name: 'Bash',
      input: { command: 'ls -la' },
    });
  });

  it('translates item.started file_change to tool_use Edit', () => {
    const events = translateCodexEvent(
      { type: 'item.started', item: { type: 'file_change', id: 'tool-2', file_path: '/tmp/foo.ts' } },
      projectPath,
    );
    expect(events).toHaveLength(1);
    expect(events[0].message.content[0]).toMatchObject({
      id: 'tool-2',
      type: 'tool_use',
      name: 'Edit',
      input: { file_path: '/tmp/foo.ts' },
    });
  });

  it('translates item.completed agent_message to text', () => {
    const events = translateCodexEvent(
      { type: 'item.completed', item: { type: 'agent_message', text: 'Hello world' } },
      projectPath,
    );
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('assistant');
    expect(events[0].message.content[0]).toMatchObject({ type: 'text', text: 'Hello world' });
  });

  it('translates item.completed command_execution to tool_result', () => {
    const events = translateCodexEvent(
      { type: 'item.completed', item: { type: 'command_execution', id: 'tool-1', aggregated_output: 'file.txt', exit_code: 0 } },
      projectPath,
    );
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('user');
    expect(events[0].message.content[0]).toMatchObject({
      type: 'tool_result',
      tool_use_id: 'tool-1',
      content: 'file.txt',
      is_error: false,
    });
  });

  it('marks failed command_execution as error', () => {
    const events = translateCodexEvent(
      { type: 'item.completed', item: { type: 'command_execution', id: 'tool-1', aggregated_output: 'err', exit_code: 1 } },
      projectPath,
    );
    expect(events[0].message.content[0].is_error).toBe(true);
  });

  it('translates turn.completed to result + done', () => {
    const events = translateCodexEvent(
      { type: 'turn.completed', usage: { input_tokens: 100, output_tokens: 50, cached_input_tokens: 10 } },
      projectPath,
    );
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe('result');
    expect(events[0].usage.input_tokens).toBe(100);
    expect(events[1].type).toBe('done');
  });

  it('translates turn.failed to error + done', () => {
    const events = translateCodexEvent(
      { type: 'turn.failed', message: 'Rate limited' },
      projectPath,
    );
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe('error');
    expect(events[0].text).toBe('Rate limited');
    expect(events[1].type).toBe('done');
  });

  it('returns empty array for unknown event types', () => {
    expect(translateCodexEvent({ type: 'unknown_thing' }, projectPath)).toEqual([]);
  });
});
