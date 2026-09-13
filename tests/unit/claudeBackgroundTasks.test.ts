import { describe, it, expect } from 'vitest';
import { BackgroundTaskTracker } from '../../electron/services/claudeBackgroundTasks';
import { translateSdkMessage } from '../../electron/services/claudeSdkTranslate';

const started = (id: string, description: string, extra: Record<string, unknown> = {}) =>
  ({ type: 'system', subtype: 'task_started', task_id: id, description, task_type: 'local_bash', ...extra });
const updated = (id: string, status: string) =>
  ({ type: 'system', subtype: 'task_updated', task_id: id, patch: { status } });
const notified = (id: string, status = 'completed') =>
  ({ type: 'system', subtype: 'task_notification', task_id: id, status });
const result = { type: 'result', subtype: 'success', result: 'waiting' };

function feed(t: BackgroundTaskTracker, msg: any) {
  return t.process(msg, translateSdkMessage(msg));
}

describe('BackgroundTaskTracker', () => {
  it('passes done through when nothing runs in the background', () => {
    const t = new BackgroundTaskTracker();
    expect(feed(t, result).map((e) => e.type)).toEqual(['result', 'done']);
    expect(t.waiting).toBe(false);
  });

  it('counts running tasks, including transcript-skipped ones, until they settle', () => {
    // A long foreground Bash also emits task_started, then nothing until it exits.
    const t = new BackgroundTaskTracker();
    feed(t, started('f1', 'sha256sum /dev/sda'));
    feed(t, started('s1', 'hidden', { skip_transcript: true }));
    expect(t.runningCount).toBe(2);
    feed(t, notified('f1'));
    expect(t.runningCount).toBe(1);
    feed(t, updated('s1', 'killed'));
    expect(t.runningCount).toBe(0);
  });

  it('holds done and reports waiting while a background task runs', () => {
    const t = new BackgroundTaskTracker();
    feed(t, started('b1', 'Write ISO to /dev/sda'));
    const out = feed(t, result);
    expect(out.map((e) => e.type)).toEqual(['result', 'waiting']);
    expect(out[1].tasks).toEqual([{ id: 'b1', description: 'Write ISO to /dev/sda' }]);
    expect(t.waiting).toBe(true);
  });

  it('reports the remaining tasks as they finish, then lets the wake-up turn finish the block', () => {
    const t = new BackgroundTaskTracker();
    feed(t, started('b1', 'one'));
    feed(t, started('b2', 'two'));
    feed(t, result);
    expect(feed(t, updated('b1', 'completed'))).toEqual([{ type: 'waiting', tasks: [{ id: 'b2', description: 'two' }] }]);
    // The notification for an already-removed task changes nothing.
    expect(feed(t, notified('b1'))).toEqual([]);
    expect(feed(t, notified('b2', 'failed'))).toEqual([{ type: 'waiting', tasks: [] }]);
    expect(t.pendingCount).toBe(0);
    expect(feed(t, result).map((e) => e.type)).toEqual(['result', 'done']);
    expect(t.waiting).toBe(false);
  });

  it('keeps waiting when the wake-up turn ends with another task still running', () => {
    const t = new BackgroundTaskTracker();
    feed(t, started('b1', 'one'));
    feed(t, started('b2', 'two'));
    feed(t, result);
    feed(t, notified('b1'));
    expect(feed(t, result).map((e) => e.type)).toEqual(['result', 'waiting']);
  });

  it('stays quiet about task changes while the wake-up turn is streaming', () => {
    const t = new BackgroundTaskTracker();
    feed(t, started('b1', 'one'));
    feed(t, started('b2', 'two'));
    feed(t, result);
    feed(t, notified('b1'));
    feed(t, { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'b1 done' }] } });
    expect(t.awaitingWake).toBe(false);
    expect(feed(t, notified('b2'))).toEqual([]);
    expect(feed(t, result).map((e) => e.type)).toEqual(['result', 'done']);
  });

  it('treats killed tasks as finished', () => {
    const t = new BackgroundTaskTracker();
    feed(t, started('b1', 'one'));
    feed(t, updated('b1', 'killed'));
    expect(feed(t, result).map((e) => e.type)).toEqual(['result', 'done']);
  });

  it('ignores non-terminal updates and ambient housekeeping tasks', () => {
    const t = new BackgroundTaskTracker();
    feed(t, started('amb', 'memory', { skip_transcript: true }));
    feed(t, started('b1', 'one'));
    feed(t, updated('b1', 'running'));
    expect(t.pendingCount).toBe(1);
    feed(t, notified('b1'));
    expect(feed(t, result).map((e) => e.type)).toEqual(['result', 'done']);
  });

  it('does not hold done for an error result', () => {
    const t = new BackgroundTaskTracker();
    feed(t, started('b1', 'one'));
    const out = feed(t, { type: 'result', subtype: 'error_during_execution', result: 'boom' });
    expect(out.map((e) => e.type)).toEqual(['error', 'done']);
    expect(t.waiting).toBe(false);
  });

  it('finish() ends a stalled wait with done', () => {
    const t = new BackgroundTaskTracker();
    feed(t, started('b1', 'one'));
    feed(t, result);
    feed(t, notified('b1'));
    expect(t.awaitingWake).toBe(true);
    expect(t.finish()).toEqual([{ type: 'done' }]);
    expect(t.waiting).toBe(false);
    expect(t.finish()).toEqual([]);
  });

  it('caps the number of tracked tasks', () => {
    const t = new BackgroundTaskTracker();
    for (let i = 0; i < 500; i++) feed(t, started(`b${i}`, 'x'));
    expect(t.pendingCount).toBeLessThanOrEqual(64);
  });
});
