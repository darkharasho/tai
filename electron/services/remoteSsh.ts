import { spawn, ChildProcess } from 'child_process';

interface SshSession {
  process: ChildProcess;
  target: string;
  buffer: string;
  pendingResolve: ((output: string) => void) | null;
  pendingReject: ((error: Error) => void) | null;
  fenceId: string | null;
}

export class RemoteSshManager {
  private sessions = new Map<string, SshSession>();

  async connect(tabId: string, target: string): Promise<void> {
    this.disconnect(tabId);

    const proc = spawn('ssh', [
      '-o', 'BatchMode=yes',
      '-o', 'ConnectTimeout=10',
      target,
      'bash', '--norc', '--noprofile',
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env as Record<string, string>,
    });

    const session: SshSession = {
      process: proc,
      target,
      buffer: '',
      pendingResolve: null,
      pendingReject: null,
      fenceId: null,
    };

    this.sessions.set(tabId, session);

    proc.on('exit', () => {
      const s = this.sessions.get(tabId);
      if (s?.pendingReject) {
        s.pendingReject(new Error('SSH connection lost (process exited)'));
        s.pendingResolve = null;
        s.pendingReject = null;
      }
      this.sessions.delete(tabId);
    });

    await this._sendAndWaitReady(tabId, session);

    proc.stderr!.removeAllListeners('data');
    proc.stderr!.on('data', (chunk: Buffer) => {
      if (session.pendingReject) {
        session.pendingReject(new Error(chunk.toString()));
        session.pendingResolve = null;
        session.pendingReject = null;
      }
    });
  }

  isConnected(tabId: string): boolean {
    const session = this.sessions.get(tabId);
    return !!session && !session.process.killed;
  }

  async execute(tabId: string, command: string, timeoutMs = 30000): Promise<{ output: string; exitCode: number }> {
    const session = this.sessions.get(tabId);
    if (!session || session.process.killed) {
      throw new Error('No SSH connection for this tab');
    }

    if (session.pendingResolve) {
      throw new Error('A command is already in progress for this tab');
    }

    const fenceId = `tai_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    session.fenceId = fenceId;
    session.buffer = '';

    const fencedCommand = `echo __TAI_START_${fenceId}__; ${command}; echo __TAI_END_${fenceId}__ $?\n`;
    session.process.stdin!.write(fencedCommand);

    return new Promise((resolve, reject) => {
      let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

      session.pendingResolve = (raw: string) => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        const endMarkerRe = new RegExp(`__TAI_END_${fenceId}__ (\\d+)`);
        const endMatch = raw.match(endMarkerRe);
        const exitCode = endMatch ? parseInt(endMatch[1], 10) : 1;
        const output = raw
          .replace(new RegExp(`__TAI_START_${fenceId}__\\n?`), '')
          .replace(endMarkerRe, '')
          .trim();
        resolve({ output, exitCode });
      };
      session.pendingReject = reject;

      timeoutHandle = setTimeout(() => {
        if (session.pendingResolve) {
          session.pendingResolve = null;
          session.pendingReject = null;
          reject(new Error(`Command timed out after ${timeoutMs}ms`));
        }
      }, timeoutMs);
    });
  }

  async getCwd(tabId: string): Promise<string> {
    const { output } = await this.execute(tabId, 'pwd', 5000);
    return output.trim();
  }

  disconnect(tabId: string): void {
    const session = this.sessions.get(tabId);
    if (session) {
      session.process.kill();
      this.sessions.delete(tabId);
    }
  }

  destroyAll(): void {
    for (const session of this.sessions.values()) {
      session.process.kill();
    }
    this.sessions.clear();
  }

  private _checkFence(session: SshSession): void {
    if (!session.fenceId) return;
    const endMarker = `__TAI_END_${session.fenceId}__`;
    if (session.buffer.includes(endMarker)) {
      const startMarker = `__TAI_START_${session.fenceId}__`;
      const startIdx = session.buffer.indexOf(startMarker);
      if (startIdx !== -1 && session.pendingResolve) {
        const content = session.buffer.slice(startIdx);
        session.pendingResolve(content);
        session.pendingResolve = null;
        session.pendingReject = null;
        session.fenceId = null;
      }
    }
  }

  private _sendAndWaitReady(tabId: string, session: SshSession): Promise<void> {
    return new Promise((resolve, reject) => {
      const readyMarker = '__TAI_READY__';
      let settled = false;

      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        fn();
      };

      const check = () => {
        if (session.buffer.includes(readyMarker)) {
          session.buffer = '';
          settle(resolve);
        }
      };

      session.process.stdout!.removeAllListeners('data');
      session.process.stdout!.on('data', (chunk: Buffer) => {
        session.buffer += chunk.toString();
        check();
        this._checkFence(session);
      });

      session.process.stderr!.removeAllListeners('data');
      session.process.stderr!.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        settle(() => {
          this.disconnect(tabId);
          reject(new Error(text));
        });
      });

      session.process.stdin!.write(`echo ${readyMarker}\n`);

      setTimeout(() => {
        settle(() => {
          this.disconnect(tabId);
          reject(new Error('SSH connection timed out'));
        });
      }, 10000);
    });
  }
}
