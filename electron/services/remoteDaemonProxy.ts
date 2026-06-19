import { spawn, ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';

export const DAEMON_CALL_TIMEOUT_MS = 180_000;
export const PONG_TIMEOUT_MS = 90_000;

interface ToolResult {
  output: string;
  isError: boolean;
}

interface PendingRequest {
  resolve: (result: ToolResult) => void;
}

export class RemoteDaemonProxy {
  private proc: ChildProcess | null = null;
  private buffer = '';
  private pending = new Map<string, PendingRequest>();
  private ready = false;
  private readyPromise: Promise<void>;
  private readyResolve!: () => void;
  private readyReject!: (err: Error) => void;
  private pingInterval: NodeJS.Timeout | null = null;
  private _lastPong = 0;
  private onDisconnect?: () => void;
  private onLspNotify?: (language: string, method: string, params: unknown) => void;

  constructor(private target: string) {
    this.readyPromise = new Promise((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
  }

  setOnDisconnect(fn: () => void) { this.onDisconnect = fn; }
  setOnLspNotify(fn: (language: string, method: string, params: unknown) => void) { this.onLspNotify = fn; }

  connect(): Promise<void> {
    this.proc = spawn('ssh', [this.target, '~/.tai/tai-daemon', '--connect'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.proc.stdout!.on('data', (chunk: Buffer) => this._handleData(chunk));
    this.proc.stderr!.on('data', (chunk: Buffer) => {
      console.error('[tai-daemon stderr]', chunk.toString().trim());
    });
    this.proc.on('exit', () => this._handleExit());

    // Timeout if ready not received within 10s
    const timeout = setTimeout(() => {
      if (!this.ready) this.readyReject(new Error('daemon did not send ready within 10s'));
    }, 10000);
    this.readyPromise.finally(() => clearTimeout(timeout));

    return this.readyPromise;
  }

  private _handleData(chunk: Buffer) {
    this.buffer += chunk.toString();
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        this._handleMessage(msg);
      } catch (e) {
        console.warn('[tai-daemon] failed to parse line:', line);
      }
    }
  }

  private _handleMessage(msg: any) {
    if (msg.type === 'ready') {
      this.ready = true;
      this.readyResolve();
      this._startHeartbeat();
      this._lastPong = Date.now();
      return;
    }
    if (msg.type === 'pong') {
      this._lastPong = Date.now();
      return;
    }
    if (msg.type === 'lsp_notify') {
      this.onLspNotify?.(msg.language, msg.method, msg.params);
      return;
    }
    // Tool response
    if (msg.id) {
      const pending = this.pending.get(msg.id);
      if (!pending) return;
      this.pending.delete(msg.id);
      if (msg.error) {
        pending.resolve({ output: msg.error, isError: true });
      } else {
        pending.resolve(this._extractResult(msg.result));
      }
    }
  }

  private _extractResult(result: any): ToolResult {
    if (!result) return { output: '', isError: false };
    // Bash result
    if ('exitCode' in result) {
      return { output: result.output ?? '', isError: result.exitCode !== 0 };
    }
    // Read result
    if ('content' in result) {
      return { output: result.content ?? '', isError: false };
    }
    // Grep result
    if ('output' in result) {
      return { output: result.output ?? '', isError: false };
    }
    // Glob result
    if ('files' in result) {
      return { output: (result.files as string[]).join('\n'), isError: false };
    }
    return { output: JSON.stringify(result), isError: false };
  }

  private _handleExit() {
    if (!this.ready) {
      this.readyReject(new Error('SSH process exited before daemon became ready'));
    }
    this.ready = false;
    if (this.pingInterval) { clearInterval(this.pingInterval); this.pingInterval = null; }
    for (const [, pending] of this.pending) {
      pending.resolve({ output: 'daemon disconnected', isError: true });
    }
    this.pending.clear();
    this.onDisconnect?.();
  }

  private _startHeartbeat() {
    this._lastPong = Date.now();
    this.pingInterval = setInterval(() => {
      if (Date.now() - this._lastPong > PONG_TIMEOUT_MS) {
        this._handleExit();
        return;
      }
      this._write({ type: 'ping' });
    }, 30000);
  }

  private _write(msg: object) {
    if (!this.proc?.stdin?.writable) return;
    this.proc.stdin.write(JSON.stringify(msg) + '\n');
  }

  async executeTool(toolName: string, input: Record<string, any>): Promise<ToolResult> {
    if (!this.ready) {
      return { output: 'daemon not connected', isError: true };
    }

    const id = randomUUID();
    const params = this._mapParams(toolName, input);
    const daemonTool = toolName.toLowerCase();

    return new Promise<ToolResult>((resolve) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) {
          resolve({ output: `daemon tool '${toolName}' timed out after ${DAEMON_CALL_TIMEOUT_MS}ms`, isError: true });
        }
      }, DAEMON_CALL_TIMEOUT_MS);
      this.pending.set(id, {
        resolve: (r) => { clearTimeout(timer); resolve(r); },
      });
      this._write({ id, tool: daemonTool, params });
    });
  }

  private _mapParams(toolName: string, input: Record<string, any>): Record<string, any> {
    switch (toolName) {
      case 'Bash':
        return { command: input.command, cwd: input.cwd, timeout: input.timeout };
      case 'Read':
        return { path: input.file_path, offset: input.offset, limit: input.limit };
      case 'Write':
        return { path: input.file_path, content: input.content };
      case 'Edit':
        return { path: input.file_path, old_string: input.old_string, new_string: input.new_string };
      case 'Grep':
        return { pattern: input.pattern, path: input.path, glob: input.glob, '-i': input['-i'] };
      case 'Glob':
        return { pattern: input.pattern, path: input.path };
      default:
        return input;
    }
  }

  isConnected(): boolean {
    return this.ready && !!this.proc && !this.proc.killed;
  }

  disconnect() {
    if (this.pingInterval) { clearInterval(this.pingInterval); this.pingInterval = null; }
    for (const [, pending] of this.pending) {
      pending.resolve({ output: 'disconnected', isError: true });
    }
    this.pending.clear();
    this.proc?.kill();
    this.proc = null;
    this.ready = false;
  }
}
