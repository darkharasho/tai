import type { RendererMsg } from './claudeSdkTranslate';

export interface BackgroundTask {
  id: string;
  description: string;
}

/** Bounds the map if the CLI never reports a task's end. */
const MAX_TASKS = 64;

const TERMINAL = new Set(['completed', 'failed', 'killed', 'stopped']);

/**
 * A `result` only ends the model's turn. When Claude backgrounds a command
 * (run_in_background, Monitor, a background subagent) the CLI stays alive and
 * starts a fresh turn once the task settles, so the block must not be closed.
 * This holds back `done` while such tasks are pending and emits `waiting`
 * envelopes instead; the wake-up turn's own `result` finishes the block.
 */
export class BackgroundTaskTracker {
  private tasks = new Map<string, BackgroundTask>();
  /** Every started task, transcript-skipped or not: the CLI is silent while any run. */
  private running = new Set<string>();
  /** A result arrived while tasks were pending; `done` is owed to the renderer. */
  waiting = false;
  /** The wake-up turn is streaming; task updates would split its text. */
  private turnActive = false;

  get pendingCount(): number {
    return this.tasks.size;
  }

  get runningCount(): number {
    return this.running.size;
  }

  /** Everything settled and still no wake-up turn: the CLI may never start one. */
  get awaitingWake(): boolean {
    return this.waiting && this.tasks.size === 0 && !this.turnActive;
  }

  process(msg: any, envs: RendererMsg[]): RendererMsg[] {
    if (msg?.type === 'system') return this.observe(msg) ? this.waitingEnvelope() : envs;
    if (msg?.type !== 'result') {
      if (msg?.type === 'assistant' || msg?.type === 'user' || msg?.type === 'stream_event') this.turnActive = true;
      return envs;
    }
    this.turnActive = false;

    const success = !msg.subtype || msg.subtype === 'success';
    if (!success || this.tasks.size === 0) {
      this.waiting = false;
      return envs;
    }
    this.waiting = true;
    return [...envs.filter((e) => e.type !== 'done'), ...this.waitingEnvelope(true)];
  }

  /** Gives up on a wake-up turn that never came. */
  finish(): RendererMsg[] {
    if (!this.waiting) return [];
    this.waiting = false;
    return [{ type: 'done' }];
  }

  /** True when the pending set changed. */
  private observe(msg: any): boolean {
    const id = typeof msg.task_id === 'string' ? msg.task_id : null;
    if (!id) return false;
    switch (msg.subtype) {
      case 'task_started': {
        this.running.add(id);
        while (this.running.size > MAX_TASKS) this.running.delete(this.running.values().next().value!);
        if (msg.skip_transcript) return false;
        this.tasks.set(id, { id, description: typeof msg.description === 'string' ? msg.description : '' });
        while (this.tasks.size > MAX_TASKS) this.tasks.delete(this.tasks.keys().next().value!);
        return true;
      }
      case 'task_updated':
        if (!TERMINAL.has(msg.patch?.status)) return false;
        this.running.delete(id);
        return this.tasks.delete(id);
      case 'task_notification':
        this.running.delete(id);
        return this.tasks.delete(id);
      default:
        return false;
    }
  }

  private waitingEnvelope(force = false): RendererMsg[] {
    if (!force && (!this.waiting || this.turnActive)) return [];
    return [{ type: 'waiting', tasks: [...this.tasks.values()] }];
  }
}
