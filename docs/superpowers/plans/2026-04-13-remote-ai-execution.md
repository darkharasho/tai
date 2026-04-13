# Remote AI Execution Over SSH — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route AI tool execution through a parallel SSH connection when the user is SSH'd into a remote host, with automatic detection and manual override.

**Architecture:** Tool calls from Claude CLI are intercepted at the `approval_needed` boundary in the main process. A remote tool proxy denies local execution, runs the equivalent command on the remote host via a parallel SSH session, and injects the result back to Claude CLI as a `tool_result`. The renderer manages remote exec mode state and augments the system prompt with remote context.

**Tech Stack:** Electron main process (Node.js), `child_process.spawn` for SSH, existing Claude CLI stream-json protocol, React renderer.

**Spec:** `docs/superpowers/specs/2026-04-13-remote-ai-execution-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `electron/services/remoteSsh.ts` | Create | SSH connection manager — spawn, execute, teardown |
| `electron/services/remoteToolProxy.ts` | Create | Intercept approval_needed, route to SSH, inject results |
| `electron/services/claude.ts` | Modify | Integrate proxy into message stream, permission override |
| `electron/preload.ts` | Modify | Expose remote exec mode IPC |
| `electron/main.ts` | Modify | Register remote exec IPC handlers |
| `src/types.ts` | Modify | Add `remoteExecMode` to TabState |
| `src/components/TerminalSession.tsx` | Modify | Pass remote state, augment system prompt |
| `src/components/TerminalInput.tsx` | Modify | Add remote/local toggle UI |
| `src/components/TerminalInput.module.css` | Modify | Styles for toggle |
| `src/App.tsx` | Modify | Manage remoteExecMode in tab state |
| `tests/unit/remoteSsh.test.ts` | Create | Unit tests for SSH manager |
| `tests/unit/remoteToolProxy.test.ts` | Create | Unit tests for tool proxy |

---

### Task 1: Remote SSH Session Manager

**Files:**
- Create: `electron/services/remoteSsh.ts`
- Create: `tests/unit/remoteSsh.test.ts`

- [ ] **Step 1: Write failing tests for SSH connection lifecycle**

Create `tests/unit/remoteSsh.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSpawn = vi.fn();
vi.mock('child_process', () => ({
  spawn: (...args: any[]) => mockSpawn(...args),
}));

import { RemoteSshManager } from '../../electron/services/remoteSsh';

function createMockProcess() {
  const proc: any = {
    stdin: { write: vi.fn() },
    stdout: { on: vi.fn(), removeAllListeners: vi.fn() },
    stderr: { on: vi.fn(), removeAllListeners: vi.fn() },
    killed: false,
    kill: vi.fn(() => { proc.killed = true; }),
    on: vi.fn(),
    pid: 12345,
  };
  return proc;
}

describe('RemoteSshManager', () => {
  let manager: RemoteSshManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new RemoteSshManager();
  });

  it('connects to a remote host by spawning ssh', async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);

    // Simulate immediate stdout ready marker
    proc.stdout.on.mockImplementation((event: string, cb: Function) => {
      if (event === 'data') {
        setTimeout(() => cb(Buffer.from('__TAI_READY__\n')), 10);
      }
    });

    await manager.connect('tab-1', 'user@host');

    expect(mockSpawn).toHaveBeenCalledWith('ssh', [
      '-o', 'BatchMode=yes',
      '-o', 'ConnectTimeout=10',
      'user@host',
      'bash', '--norc', '--noprofile',
    ], expect.any(Object));
  });

  it('returns connection status', async () => {
    expect(manager.isConnected('tab-1')).toBe(false);

    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);
    proc.stdout.on.mockImplementation((event: string, cb: Function) => {
      if (event === 'data') {
        setTimeout(() => cb(Buffer.from('__TAI_READY__\n')), 10);
      }
    });

    await manager.connect('tab-1', 'user@host');
    expect(manager.isConnected('tab-1')).toBe(true);
  });

  it('disconnects and kills the process', async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);
    proc.stdout.on.mockImplementation((event: string, cb: Function) => {
      if (event === 'data') {
        setTimeout(() => cb(Buffer.from('__TAI_READY__\n')), 10);
      }
    });

    await manager.connect('tab-1', 'user@host');
    manager.disconnect('tab-1');

    expect(proc.kill).toHaveBeenCalled();
    expect(manager.isConnected('tab-1')).toBe(false);
  });

  it('destroyAll kills all connections', async () => {
    const proc1 = createMockProcess();
    const proc2 = createMockProcess();
    mockSpawn.mockReturnValueOnce(proc1).mockReturnValueOnce(proc2);

    proc1.stdout.on.mockImplementation((event: string, cb: Function) => {
      if (event === 'data') setTimeout(() => cb(Buffer.from('__TAI_READY__\n')), 10);
    });
    proc2.stdout.on.mockImplementation((event: string, cb: Function) => {
      if (event === 'data') setTimeout(() => cb(Buffer.from('__TAI_READY__\n')), 10);
    });

    await manager.connect('tab-1', 'user@host1');
    await manager.connect('tab-2', 'user@host2');
    manager.destroyAll();

    expect(proc1.kill).toHaveBeenCalled();
    expect(proc2.kill).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/remoteSsh.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement RemoteSshManager**

Create `electron/services/remoteSsh.ts`:

```typescript
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
      env: process.env,
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
      this.sessions.delete(tabId);
    });

    proc.stderr!.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      if (session.pendingReject) {
        session.pendingReject(new Error(text));
        session.pendingResolve = null;
        session.pendingReject = null;
      }
    });

    proc.stdout!.on('data', (chunk: Buffer) => {
      session.buffer += chunk.toString();
      this._checkFence(session);
    });

    await this._sendAndWaitReady(session);
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

    const fenceId = `tai_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    session.fenceId = fenceId;
    session.buffer = '';

    const fencedCommand = `echo __TAI_START_${fenceId}__; ${command}; echo __TAI_END_${fenceId}__ $?\n`;
    session.process.stdin!.write(fencedCommand);

    return new Promise((resolve, reject) => {
      session.pendingResolve = (raw: string) => {
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

      setTimeout(() => {
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

  private _sendAndWaitReady(session: SshSession): Promise<void> {
    return new Promise((resolve, reject) => {
      const readyMarker = '__TAI_READY__';

      const check = () => {
        if (session.buffer.includes(readyMarker)) {
          session.buffer = '';
          resolve();
        }
      };

      const origHandler = session.process.stdout!.listeners('data').slice(-1)[0] as Function;
      const wrappedHandler = (chunk: Buffer) => {
        origHandler(chunk);
        check();
      };
      session.process.stdout!.removeAllListeners('data');
      session.process.stdout!.on('data', (chunk: Buffer) => {
        session.buffer += chunk.toString();
        check();
        this._checkFence(session);
      });

      session.process.stdin!.write(`echo ${readyMarker}\n`);

      setTimeout(() => {
        if (!session.buffer.includes(readyMarker)) {
          this.disconnect(session.target);
          reject(new Error('SSH connection timed out'));
        }
      }, 10000);
    });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/remoteSsh.test.ts`
Expected: PASS (all 4 tests)

- [ ] **Step 5: Commit**

```bash
git add electron/services/remoteSsh.ts tests/unit/remoteSsh.test.ts
git commit -m "feat: add RemoteSshManager for parallel SSH connections"
```

---

### Task 2: Remote Tool Proxy

**Files:**
- Create: `electron/services/remoteToolProxy.ts`
- Create: `tests/unit/remoteToolProxy.test.ts`

- [ ] **Step 1: Write failing tests for tool proxy**

Create `tests/unit/remoteToolProxy.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RemoteToolProxy } from '../../electron/services/remoteToolProxy';

function createMockSshManager() {
  return {
    isConnected: vi.fn().mockReturnValue(true),
    execute: vi.fn().mockResolvedValue({ output: 'mock output', exitCode: 0 }),
    getCwd: vi.fn().mockResolvedValue('/home/user'),
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn(),
    destroyAll: vi.fn(),
  };
}

describe('RemoteToolProxy', () => {
  let proxy: RemoteToolProxy;
  let ssh: ReturnType<typeof createMockSshManager>;

  beforeEach(() => {
    ssh = createMockSshManager();
    proxy = new RemoteToolProxy(ssh as any);
  });

  it('executes Bash tool via SSH', async () => {
    const result = await proxy.executeRemoteTool('tab-1', 'Bash', { command: 'ls -la' });

    expect(ssh.execute).toHaveBeenCalledWith('tab-1', 'ls -la', 30000);
    expect(result.output).toBe('mock output');
    expect(result.isError).toBe(false);
  });

  it('executes Read tool as cat command', async () => {
    ssh.execute.mockResolvedValue({ output: '     1\tline one\n     2\tline two', exitCode: 0 });

    const result = await proxy.executeRemoteTool('tab-1', 'Read', { file_path: '/etc/hosts' });

    expect(ssh.execute).toHaveBeenCalledWith('tab-1', "cat -n '/etc/hosts'", 30000);
  });

  it('executes Read tool with offset and limit', async () => {
    const result = await proxy.executeRemoteTool('tab-1', 'Read', {
      file_path: '/etc/hosts',
      offset: 10,
      limit: 20,
    });

    expect(ssh.execute).toHaveBeenCalledWith(
      'tab-1',
      "cat -n '/etc/hosts' | tail -n +10 | head -n 20",
      30000,
    );
  });

  it('executes Write tool as heredoc', async () => {
    const content = 'line 1\nline 2\n';
    const result = await proxy.executeRemoteTool('tab-1', 'Write', {
      file_path: '/tmp/test.txt',
      content,
    });

    const call = ssh.execute.mock.calls[0][1] as string;
    expect(call).toContain("cat << 'TAI_EOF_");
    expect(call).toContain("> '/tmp/test.txt'");
    expect(call).toContain(content);
  });

  it('executes Grep tool as grep command', async () => {
    const result = await proxy.executeRemoteTool('tab-1', 'Grep', {
      pattern: 'TODO',
      path: '/home/user/project',
    });

    const call = ssh.execute.mock.calls[0][1] as string;
    expect(call).toContain('grep');
    expect(call).toContain('TODO');
  });

  it('executes Glob tool as find command', async () => {
    const result = await proxy.executeRemoteTool('tab-1', 'Glob', {
      pattern: '**/*.ts',
      path: '/home/user/project',
    });

    const call = ssh.execute.mock.calls[0][1] as string;
    expect(call).toContain('find');
    expect(call).toContain('.ts');
  });

  it('returns error for unsupported tools', async () => {
    const result = await proxy.executeRemoteTool('tab-1', 'Edit', {
      file_path: '/tmp/test.txt',
      old_string: 'a',
      new_string: 'b',
    });

    expect(result.isError).toBe(true);
    expect(result.output).toContain('not available on remote hosts');
    expect(ssh.execute).not.toHaveBeenCalled();
  });

  it('reports non-zero exit code as error', async () => {
    ssh.execute.mockResolvedValue({ output: 'No such file', exitCode: 1 });

    const result = await proxy.executeRemoteTool('tab-1', 'Bash', { command: 'cat missing' });

    expect(result.isError).toBe(true);
    expect(result.output).toContain('No such file');
  });

  it('handles SSH execution failure gracefully', async () => {
    ssh.execute.mockRejectedValue(new Error('Connection lost'));

    const result = await proxy.executeRemoteTool('tab-1', 'Bash', { command: 'ls' });

    expect(result.isError).toBe(true);
    expect(result.output).toContain('Connection lost');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/remoteToolProxy.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement RemoteToolProxy**

Create `electron/services/remoteToolProxy.ts`:

```typescript
import type { RemoteSshManager } from './remoteSsh';

interface ToolResult {
  output: string;
  isError: boolean;
}

const SUPPORTED_TOOLS = new Set(['Bash', 'Read', 'Write', 'Grep', 'Glob']);
const COMMAND_TIMEOUT = 30000;

export class RemoteToolProxy {
  constructor(private ssh: RemoteSshManager) {}

  async executeRemoteTool(tabId: string, toolName: string, input: Record<string, any>): Promise<ToolResult> {
    if (!SUPPORTED_TOOLS.has(toolName)) {
      return {
        output: `The "${toolName}" tool is not available on remote hosts. Use Bash with shell commands (cat, sed, tee) to accomplish file operations instead.`,
        isError: true,
      };
    }

    try {
      switch (toolName) {
        case 'Bash': return await this._execBash(tabId, input);
        case 'Read': return await this._execRead(tabId, input);
        case 'Write': return await this._execWrite(tabId, input);
        case 'Grep': return await this._execGrep(tabId, input);
        case 'Glob': return await this._execGlob(tabId, input);
        default: return { output: `Unknown tool: ${toolName}`, isError: true };
      }
    } catch (err: any) {
      return { output: `Remote execution failed: ${err.message}`, isError: true };
    }
  }

  private async _execBash(tabId: string, input: Record<string, any>): Promise<ToolResult> {
    const command = input.command as string;
    const timeout = (input.timeout as number) || COMMAND_TIMEOUT;
    const { output, exitCode } = await this.ssh.execute(tabId, command, timeout);
    return { output, isError: exitCode !== 0 };
  }

  private async _execRead(tabId: string, input: Record<string, any>): Promise<ToolResult> {
    const filePath = this._escapePath(input.file_path as string);
    let cmd = `cat -n ${filePath}`;
    if (input.offset) cmd += ` | tail -n +${input.offset}`;
    if (input.limit) cmd += ` | head -n ${input.limit}`;
    const { output, exitCode } = await this.ssh.execute(tabId, cmd, COMMAND_TIMEOUT);
    return { output, isError: exitCode !== 0 };
  }

  private async _execWrite(tabId: string, input: Record<string, any>): Promise<ToolResult> {
    const filePath = this._escapePath(input.file_path as string);
    const content = input.content as string;
    const delimiter = `TAI_EOF_${Math.random().toString(36).slice(2, 10)}`;
    const cmd = `mkdir -p $(dirname ${filePath}) && cat << '${delimiter}' > ${filePath}\n${content}\n${delimiter}`;
    const { output, exitCode } = await this.ssh.execute(tabId, cmd, COMMAND_TIMEOUT);
    return { output: output || 'File written successfully.', isError: exitCode !== 0 };
  }

  private async _execGrep(tabId: string, input: Record<string, any>): Promise<ToolResult> {
    const pattern = input.pattern as string;
    const searchPath = input.path ? this._escapePath(input.path as string) : '.';
    const flags = ['-rn'];
    if (input['-i']) flags.push('-i');
    if (input.glob) flags.push(`--include=${this._escapeArg(input.glob)}`);
    if (input.type) flags.push(`--include='*.${input.type}'`);
    const limit = input.head_limit ?? 250;
    let cmd = `grep ${flags.join(' ')} ${this._escapeArg(pattern)} ${searchPath}`;
    if (limit > 0) cmd += ` | head -n ${limit}`;
    const { output, exitCode } = await this.ssh.execute(tabId, cmd, COMMAND_TIMEOUT);
    // grep returns 1 for no matches — not an error
    return { output: output || 'No matches found.', isError: exitCode > 1 };
  }

  private async _execGlob(tabId: string, input: Record<string, any>): Promise<ToolResult> {
    const pattern = input.pattern as string;
    const searchPath = input.path ? this._escapePath(input.path as string) : '.';
    const namePattern = pattern.replace(/\*\*\//g, '').replace(/\*/g, '*');
    let cmd = `find ${searchPath} -name ${this._escapeArg(namePattern)} -type f 2>/dev/null | head -n 200 | sort`;
    const { output, exitCode } = await this.ssh.execute(tabId, cmd, COMMAND_TIMEOUT);
    return { output: output || 'No files found.', isError: exitCode !== 0 };
  }

  private _escapePath(p: string): string {
    return `'${p.replace(/'/g, "'\\''")}'`;
  }

  private _escapeArg(arg: string): string {
    return `'${arg.replace(/'/g, "'\\''")}'`;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/remoteToolProxy.test.ts`
Expected: PASS (all 8 tests)

- [ ] **Step 5: Commit**

```bash
git add electron/services/remoteToolProxy.ts tests/unit/remoteToolProxy.test.ts
git commit -m "feat: add RemoteToolProxy for routing tool calls through SSH"
```

---

### Task 3: Wire Remote State into Tab Management

**Files:**
- Modify: `src/types.ts:43-52`
- Modify: `src/App.tsx:17-20, 84-86`
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`
- Modify: `src/types/window.d.ts`

- [ ] **Step 1: Add remoteExecMode to TabState**

In `src/types.ts`, update the `TabState` interface at line 43:

```typescript
export interface TabState {
  id: string;
  ptyId: number | null;
  label: string;
  cwd: string;
  contextMode: ContextMode;
  trustLevel: TrustLevel;
  isRemote: boolean;
  sshTarget: string | null;
  remoteExecMode: 'auto' | 'local';
}
```

- [ ] **Step 2: Update createTabState in App.tsx**

In `src/App.tsx`, update `createTabState` at line 17:

```typescript
function createTabState(): TabState {
  const id = `tab-${++tabCounter}`;
  return { id, ptyId: null, label: 'zsh', cwd: '', contextMode: 'shell', trustLevel: 'ask', isRemote: false, sshTarget: null, remoteExecMode: 'auto' };
}
```

- [ ] **Step 3: Add remoteExecMode change handler in App.tsx**

In `src/App.tsx`, after the `handleRemoteChange` callback (line 86), add:

```typescript
const handleRemoteExecModeChange = useCallback((tabId: string, mode: 'auto' | 'local') => {
  setTabs(prev => prev.map(t => t.id === tabId ? { ...t, remoteExecMode: mode } : t));
}, []);
```

- [ ] **Step 4: Add IPC handlers for remote exec mode**

In `electron/main.ts`, after the `system:hostname` handler, add:

```typescript
ipcMain.handle('remote:setExecMode', (_event, tabId: string, mode: string) => {
  // State is managed in renderer — this is a pass-through for future use
  return true;
});
```

In `electron/preload.ts`, add to the `system` block:

```typescript
system: {
  getHostname: () => ipcRenderer.invoke('system:hostname'),
  setRemoteExecMode: (tabId: string, mode: string) => ipcRenderer.invoke('remote:setExecMode', tabId, mode),
},
```

In `src/types/window.d.ts`, update the `system` block:

```typescript
system: {
  getHostname: () => Promise<string>;
  setRemoteExecMode: (tabId: string, mode: string) => Promise<boolean>;
};
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/App.tsx electron/main.ts electron/preload.ts src/types/window.d.ts
git commit -m "feat: add remoteExecMode to tab state with IPC wiring"
```

---

### Task 4: Integrate Remote Tool Proxy into Claude Service

**Files:**
- Modify: `electron/services/claude.ts`

This is the core integration — intercepting `approval_needed` messages and routing through the proxy when in remote mode.

- [ ] **Step 1: Add remote state tracking to ClaudeState**

In `electron/services/claude.ts`, update the `ClaudeState` interface at line 6:

```typescript
interface ClaudeState {
  process: ChildProcess | null;
  sessionId: string | null;
  buffer: string;
  busy: boolean;
  remoteTarget: string | null;
  remoteExecMode: 'auto' | 'local';
}
```

Update `getState` at line 18 to include new defaults:

```typescript
state = { process: null, sessionId: null, buffer: '', busy: false, remoteTarget: null, remoteExecMode: 'auto' };
```

- [ ] **Step 2: Import and instantiate remote services**

At the top of `electron/services/claude.ts`, after existing imports:

```typescript
import { RemoteSshManager } from './remoteSsh';
import { RemoteToolProxy } from './remoteToolProxy';

const sshManager = new RemoteSshManager();
const toolProxy = new RemoteToolProxy(sshManager);
```

- [ ] **Step 3: Add IPC handlers for remote state updates**

Inside `setupClaudeService`, after the `ai:stop` handler (after line 152), add:

```typescript
ipcMain.handle('ai:setRemoteTarget', (_event, key: string, target: string | null, mode: string) => {
  const state = getState(key);
  state.remoteTarget = target;
  state.remoteExecMode = mode as 'auto' | 'local';
  if (!target) {
    sshManager.disconnect(key);
  }
  return true;
});
```

- [ ] **Step 4: Override permission mode when remote**

In `ensureProcess`, modify the permission mode logic at lines 59-65. Replace with:

```typescript
const state = getState(key);
const isRemoteExec = state.remoteTarget && state.remoteExecMode === 'auto';

if (isRemoteExec) {
  // Force acceptEdits when remote to guarantee approval_needed interception
  args.push('--permission-mode', 'acceptEdits');
} else if (permMode === 'bypass') {
  args.push('--permission-mode', 'bypassPermissions');
} else if (permMode === 'approve-edits') {
  args.push('--permission-mode', 'acceptEdits');
} else {
  args.push('--permission-mode', 'acceptEdits');
}
```

Note: Because `ensureProcess` reuses existing processes, the permission override applies when the process is first spawned. If the user transitions to remote mid-session, the Claude CLI process must be restarted. Add a kill+respawn in the `ai:setRemoteTarget` handler:

```typescript
ipcMain.handle('ai:setRemoteTarget', (_event, key: string, target: string | null, mode: string) => {
  const state = getState(key);
  const wasRemote = state.remoteTarget && state.remoteExecMode === 'auto';
  state.remoteTarget = target;
  state.remoteExecMode = mode as 'auto' | 'local';
  const isRemote = state.remoteTarget && state.remoteExecMode === 'auto';

  // Restart Claude CLI if remote status changed (permission mode differs)
  if (wasRemote !== isRemote && state.process && !state.process.killed) {
    state.process.kill();
    state.process = null;
    state.sessionId = null;
  }

  if (!target) {
    sshManager.disconnect(key);
  }
  return true;
});
```

- [ ] **Step 5: Intercept approval_needed for remote execution**

In the `proc.stdout` data handler (line 84-107), after parsing the message, add interception logic. Replace the message forwarding section:

```typescript
for (const line of lines) {
  if (!line.trim()) continue;
  try {
    const msg = JSON.parse(line);

    if (msg.type === 'system' && msg.session_id) {
      state.sessionId = msg.session_id;
    }

    if (msg.type === 'result') {
      state.busy = false;
      safeSend(win, 'ai:message', key, { type: 'done', content: msg });
      continue;
    }

    // Remote tool interception
    const isRemoteExec = state.remoteTarget && state.remoteExecMode === 'auto';
    if (isRemoteExec && msg.type === 'assistant' && msg.message?.content) {
      const toolUses = (Array.isArray(msg.message.content) ? msg.message.content : [])
        .filter((b: any) => b.type === 'tool_use');

      if (toolUses.length > 0) {
        // Forward the message to show the tool call in UI
        safeSend(win, 'ai:message', key, msg);
        // Execute each tool remotely and inject results
        handleRemoteToolCalls(win, key, state, toolUses);
        continue;
      }
    }

    safeSend(win, 'ai:message', key, msg);
  } catch {}
}
```

- [ ] **Step 6: Implement handleRemoteToolCalls**

Add this function before `setupClaudeService`:

```typescript
async function handleRemoteToolCalls(
  win: BrowserWindow | null,
  key: string,
  state: ClaudeState,
  toolUses: Array<{ id: string; name: string; input: Record<string, any> }>,
) {
  // Ensure SSH connection is established
  if (!sshManager.isConnected(key) && state.remoteTarget) {
    try {
      await sshManager.connect(key, state.remoteTarget);
    } catch (err: any) {
      // Connection failed — send error results for all tools
      for (const tool of toolUses) {
        const errorResult = JSON.stringify({
          type: 'user',
          message: {
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: tool.id,
              content: `SSH connection failed: ${err.message}. AI commands will run locally.`,
              is_error: true,
            }],
          },
        });
        state.process?.stdin!.write(errorResult + '\n');
      }
      safeSend(win, 'ai:message', key, {
        type: 'remote:connection_failed',
        error: err.message,
      });
      return;
    }
  }

  for (const tool of toolUses) {
    const result = await toolProxy.executeRemoteTool(key, tool.name, tool.input);

    // Truncate large output
    let output = result.output;
    const MAX_OUTPUT = 100 * 1024;
    if (output.length > MAX_OUTPUT) {
      output = output.slice(0, MAX_OUTPUT) + '\n[output truncated at 100KB]';
    }

    // Inject result back to Claude CLI
    const toolResult = JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: tool.id,
          content: output,
          is_error: result.isError,
        }],
      },
    });
    state.process?.stdin!.write(toolResult + '\n');

    // Forward result to renderer for display
    safeSend(win, 'ai:message', key, {
      type: 'user',
      message: {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: tool.id,
          content: output,
          is_error: result.isError,
        }],
      },
    });
  }
}
```

- [ ] **Step 7: Add cleanup for SSH on destroyAllClaude**

Update `destroyAllClaude` at line 172:

```typescript
export function destroyAllClaude() {
  for (const state of claudeStates.values()) {
    if (state.process) state.process.kill();
  }
  claudeStates.clear();
  sshManager.destroyAll();
}
```

- [ ] **Step 8: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 9: Commit**

```bash
git add electron/services/claude.ts
git commit -m "feat: integrate remote tool proxy into Claude service message stream"
```

---

### Task 5: Wire Remote State from Renderer to Main Process

**Files:**
- Modify: `electron/preload.ts`
- Modify: `src/types/window.d.ts`
- Modify: `src/components/TerminalSession.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Add IPC bridge for remote target**

In `electron/preload.ts`, add to the `ai` block (after the `onError` method):

```typescript
setRemoteTarget: (key: string, target: string | null, mode: string) =>
  ipcRenderer.invoke('ai:setRemoteTarget', key, target, mode),
```

In `src/types/window.d.ts`, add to the `ai` block (after `onError`):

```typescript
setRemoteTarget: (key: string, target: string | null, mode: string) => Promise<boolean>;
```

- [ ] **Step 2: Pass remoteExecMode to TerminalSession**

In `src/App.tsx`, update the TerminalSession rendering (around line 143) to pass the new props:

```typescript
<TerminalSession
  tabId={tab.id}
  ptyId={tab.ptyId}
  cwd={tab.cwd}
  visible={tab.id === activeTabId}
  trustLevel={tab.trustLevel}
  remoteExecMode={tab.remoteExecMode}
  onContextModeChange={(mode) => handleContextModeChange(tab.id, mode)}
  onRemoteChange={(isRemote, sshTarget) => handleRemoteChange(tab.id, isRemote, sshTarget)}
  onRemoteExecModeChange={(mode) => handleRemoteExecModeChange(tab.id, mode)}
/>
```

- [ ] **Step 3: Update TerminalSession props and sync remote state**

In `src/components/TerminalSession.tsx`, update the props interface (line 12):

```typescript
interface TerminalSessionProps {
  tabId: string;
  ptyId: number | null;
  cwd: string;
  visible: boolean;
  trustLevel: TrustLevel;
  remoteExecMode: 'auto' | 'local';
  onContextModeChange: (mode: ContextMode) => void;
  onRemoteChange: (isRemote: boolean, sshTarget: string | null) => void;
  onRemoteExecModeChange: (mode: 'auto' | 'local') => void;
}
```

Update the component destructuring (line 26):

```typescript
export function TerminalSession({ tabId, ptyId, cwd: initialCwd, visible, trustLevel, remoteExecMode, onContextModeChange, onRemoteChange, onRemoteExecModeChange }: TerminalSessionProps) {
```

Add an effect to sync remote state to the main process. After the existing `onPromptChange` callback setup (around line 155), add a new effect:

```typescript
useEffect(() => {
  const target = promptInfo?.isRemote ? (promptInfo.sshTarget ?? null) : null;
  window.tai?.ai?.setRemoteTarget(tabId, target, remoteExecMode);
}, [tabId, promptInfo?.isRemote, promptInfo?.sshTarget, remoteExecMode]);
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add electron/preload.ts src/types/window.d.ts src/App.tsx src/components/TerminalSession.tsx
git commit -m "feat: sync remote exec state from renderer to main process"
```

---

### Task 6: Augment AI System Prompt for Remote Context

**Files:**
- Modify: `src/components/TerminalSession.tsx:252-278`

- [ ] **Step 1: Update preamble construction**

In `src/components/TerminalSession.tsx`, find the preamble construction inside `handleAIRequest` (around line 258). Replace the preamble block:

```typescript
let fullPrompt = prompt;
if (!preambleSentRef.current) {
  preambleSentRef.current = true;

  const isRemoteExec = promptInfo?.isRemote && remoteExecMode === 'auto';
  const remoteCwd = isRemoteExec ? '(determined at runtime on remote host)' : undefined;

  const lines = [
    'You are a general-purpose AI terminal assistant.',
    '',
    'Your default mode is as a system-wide helper:',
    '- Answer general questions (tech, trivia, how-tos, troubleshooting, etc.)',
    '- Help with shell commands, system administration, networking, file management',
    '',
    'When the user asks about code or development tasks, shift into developer mode:',
    '- Use tools (Bash, Read, Write, Edit) to actually do the work rather than just explaining',
    '- Run commands yourself instead of just suggesting them',
    '',
    'General guidelines:',
    '- Be concise and direct. Lead with the answer or action.',
    '- When showing commands, use ```bash code blocks.',
    '- Skip pleasantries and unnecessary explanation.',
    `- Working directory: ${cwd}`,
  ];

  if (isRemoteExec && promptInfo?.sshTarget) {
    lines.push(
      '',
      `REMOTE EXECUTION: You are connected to remote host: ${promptInfo.sshTarget}`,
      'All Bash commands execute on the remote host, not locally.',
      'Available tools: Bash, Read (via cat), Write (via heredoc), Grep (via grep).',
      'The Edit tool is NOT available remotely. Use sed or write the full file with a heredoc instead.',
      'The Glob tool uses find on the remote host.',
    );
  }

  const preamble = lines.join('\n');
  fullPrompt = `<system>\n${preamble}\n</system>\n\n${prompt}`;
}
```

- [ ] **Step 2: Add remoteExecMode to the handleAIRequest dependency array**

Update the `useCallback` dependency array for `handleAIRequest` (around line 413):

```typescript
}, [cwd, trustLevel, handleInputModeChange, promptInfo, remoteExecMode]);
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Run existing tests**

Run: `npx vitest run`
Expected: All tests pass (no behavior change for existing tests)

- [ ] **Step 5: Commit**

```bash
git add src/components/TerminalSession.tsx
git commit -m "feat: augment AI system prompt with remote execution context"
```

---

### Task 7: Remote/Local Toggle UI

**Files:**
- Modify: `src/components/TerminalInput.tsx`
- Modify: `src/components/TerminalInput.module.css`

- [ ] **Step 1: Add toggle props to TerminalInput**

In `src/components/TerminalInput.tsx`, update the props interface (around line 41):

```typescript
interface TerminalInputProps {
  onSubmit: (value: string) => void;
  mode: InputMode;
  onModeChange: (mode: InputMode) => void;
  disabled?: boolean;
  cwd: string;
  promptInfo?: { text: string; isRemote: boolean; sshTarget?: string } | null;
  history?: string[];
  onClear?: () => void;
  initialValue?: string;
  remoteExecMode?: 'auto' | 'local';
  onRemoteExecModeChange?: (mode: 'auto' | 'local') => void;
}
```

- [ ] **Step 2: Add toggle rendering**

In the prompt display section (around line 246, after the SSH target display logic), add a toggle button. Find where `promptIsRemote` is set and the prompt area is rendered. After the SSH target userName display, add:

```typescript
const remoteExecActive = promptIsRemote && remoteExecMode === 'auto';
```

In the JSX, near the prompt info area where the SSH target is displayed, add a clickable toggle. Find the element that renders `userName` when remote (around line 270) and after it, add:

```tsx
{promptIsRemote && onRemoteExecModeChange && (
  <button
    className={styles.remoteToggle}
    onClick={(e) => {
      e.stopPropagation();
      onRemoteExecModeChange(remoteExecMode === 'auto' ? 'local' : 'auto');
    }}
    title={remoteExecActive ? 'AI executes on remote host — click for local' : 'AI executes locally — click for remote'}
  >
    {remoteExecActive ? 'Remote' : 'Local'}
  </button>
)}
```

- [ ] **Step 3: Add toggle styles**

In `src/components/TerminalInput.module.css`, add:

```css
.remoteToggle {
  background: none;
  border: 1px solid var(--color-agent-dim, rgba(255, 160, 60, 0.3));
  color: var(--color-agent, #ffa03c);
  font-size: 9px;
  font-family: inherit;
  padding: 1px 5px;
  border-radius: 3px;
  cursor: pointer;
  margin-left: 6px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  transition: background 0.15s, border-color 0.15s;
}

.remoteToggle:hover {
  background: rgba(255, 160, 60, 0.1);
  border-color: var(--color-agent, #ffa03c);
}
```

- [ ] **Step 4: Pass toggle props from TerminalSession**

In `src/components/TerminalSession.tsx`, update the TerminalInput rendering (around line 551):

```tsx
<TerminalInput
  ref={inputRef}
  onSubmit={handleSubmit}
  mode={inputMode}
  onModeChange={handleInputModeChange}
  cwd={cwd}
  promptInfo={promptInfo}
  initialValue={editValue}
  disabled={false}
  history={inputHistory}
  onClear={() => setDisplayItems([])}
  remoteExecMode={remoteExecMode}
  onRemoteExecModeChange={onRemoteExecModeChange}
/>
```

- [ ] **Step 5: Verify TypeScript compiles and tests pass**

Run: `npx tsc --noEmit && npx vitest run`
Expected: No errors, all tests pass

- [ ] **Step 6: Commit**

```bash
git add src/components/TerminalInput.tsx src/components/TerminalInput.module.css src/components/TerminalSession.tsx
git commit -m "feat: add remote/local AI execution toggle in terminal input"
```

---

### Task 8: Handle Connection Failure & SSH Exit

**Files:**
- Modify: `src/components/TerminalSession.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Handle remote:connection_failed messages in TerminalSession**

In `src/components/TerminalSession.tsx`, in the `providerRef.current.onMessage` callback (around line 280), add a handler for the connection failure message. Before the `if (msg.type === 'result')` check, add:

```typescript
if (msg.type === 'remote:connection_failed') {
  setDisplayItems(prev => [...prev, {
    type: 'ai' as const,
    id: nextBlockId(),
    question: '',
    content: `**SSH connection failed:** ${msg.error}\n\nAI commands will run locally. Use key-based SSH auth for remote AI support.`,
    suggestedCommands: [],
    streaming: false,
    entries: [{ kind: 'text', text: `**SSH connection failed:** ${msg.error}\n\nAI commands will run locally.` }],
  }]);
  onRemoteExecModeChange('local');
  return;
}
```

- [ ] **Step 2: Reset remote exec mode when SSH exits**

In `src/App.tsx`, update `handleRemoteChange` (line 84) to reset exec mode when SSH ends:

```typescript
const handleRemoteChange = useCallback((tabId: string, isRemote: boolean, sshTarget: string | null) => {
  setTabs(prev => prev.map(t => {
    if (t.id !== tabId) return t;
    const updates: Partial<TabState> = { isRemote, sshTarget };
    if (!isRemote) updates.remoteExecMode = 'auto';
    return { ...t, ...updates };
  }));
}, []);
```

- [ ] **Step 3: Verify TypeScript compiles and tests pass**

Run: `npx tsc --noEmit && npx vitest run`
Expected: No errors, all tests pass

- [ ] **Step 4: Commit**

```bash
git add src/components/TerminalSession.tsx src/App.tsx
git commit -m "feat: handle SSH connection failure and session exit gracefully"
```

---

### Task 9: End-to-End Verification

**Files:** None — manual testing

- [ ] **Step 1: Build the app**

Run: `npm run build`
Expected: Build succeeds with no errors

- [ ] **Step 2: Test local AI execution (regression)**

1. Open TAI
2. Ask the AI "what files are in the current directory?"
3. Verify it executes `ls` locally and returns results
4. Verify approval flow works as before

- [ ] **Step 3: Test remote AI execution**

1. SSH into a remote host from a TAI terminal tab
2. Verify the "Remote" toggle appears in the input area
3. Ask the AI "what's the hostname?"
4. Verify the AI executes on the remote host (output should show remote hostname)
5. Verify the system prompt mentions the remote host

- [ ] **Step 4: Test toggle to local**

1. While SSH'd, click the toggle to switch to "Local"
2. Ask the AI "what's the hostname?"
3. Verify it returns the local hostname

- [ ] **Step 5: Test SSH exit cleanup**

1. Type `exit` to leave the SSH session
2. Verify the toggle disappears
3. Verify AI reverts to local execution

- [ ] **Step 6: Test connection failure**

1. SSH into a host that requires password auth (or use a nonexistent host)
2. Ask the AI a question
3. Verify the connection failure message appears
4. Verify the mode flips to "Local" automatically

- [ ] **Step 7: Commit any fixes**

```bash
git add -A
git commit -m "fix: address issues found during e2e testing"
```
