import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Electron stubs ────────────────────────────────────────────────────────────
const handlers = new Map<string, (...args: any[]) => any>();
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, fn: (...args: any[]) => any) => { handlers.set(channel, fn); }),
    on: vi.fn(),
  },
  BrowserWindow: vi.fn(),
}));

// ── Node stubs ────────────────────────────────────────────────────────────────
vi.mock('node:os', () => ({ default: { homedir: () => '/home/test' } }));
vi.mock('node:path', async () => {
  const actual = await vi.importActual<typeof import('path')>('path');
  return { default: actual };
});
vi.mock('node:fs', () => ({
  default: { existsSync: () => false, readdirSync: () => [] },
}));

// ── Gemini ACP client factory stub ───────────────────────────────────────────
//
// We control the mock inside each test via `mockClientFactory`.
let mockClientFactory: () => any = () => { throw new Error('no factory set'); };

vi.mock('../../electron/services/gemini-acp', () => ({
  createGeminiAcpClient: vi.fn((...args: any[]) => mockClientFactory()),
}));

// ── platform stub ─────────────────────────────────────────────────────────────
vi.mock('../../electron/services/platform', () => ({
  enrichEnv: () => ({}),
}));

// ── Import the module under test (after mocks are registered) ─────────────────
import { setupGeminiService } from '../../electron/services/gemini';

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeWindow() {
  const sent: Array<[string, ...any[]]> = [];
  return {
    sent,
    isDestroyed: () => false,
    webContents: {
      send: vi.fn((...args: any[]) => { sent.push(args as any); }),
    },
  } as any;
}

function makeFakeClient(opts: {
  /** If true, request('session/prompt') never resolves/rejects (simulates hang) */
  hangPrompt?: boolean;
  /** If provided, request('session/prompt') rejects with this error */
  promptError?: Error;
}) {
  const disposed: string[] = [];
  const client = {
    start: vi.fn().mockResolvedValue(undefined),
    request: vi.fn((method: string, _params?: any) => {
      if (method === 'session/new') return Promise.resolve({ sessionId: 'sess-1' });
      if (method === 'session/prompt') {
        if (opts.hangPrompt) return new Promise(() => { /* never resolves */ });
        if (opts.promptError) return Promise.reject(opts.promptError);
      }
      return Promise.resolve({});
    }),
    respond: vi.fn(),
    notify: vi.fn(),
    onEvent: vi.fn(() => () => {}),
    onStderr: vi.fn(),
    dispose: vi.fn(() => { disposed.push('dispose'); }),
    _disposed: disposed,
  };
  return client;
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('gemini request-level timeout', () => {
  beforeEach(() => {
    handlers.clear();
    vi.useFakeTimers();
    setupGeminiService(() => null); // registers handlers; window is null (safeSend guards it)
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('settles with ai:error + done when session/prompt hangs for 120 s', async () => {
    const win = makeWindow();
    const fakeClient = makeFakeClient({ hangPrompt: true });
    mockClientFactory = () => fakeClient;

    // Override getWindow to return our tracking window
    handlers.clear();
    setupGeminiService(() => win);

    const sendHandler = handlers.get('gemini:send')!;
    expect(sendHandler).toBeDefined();

    // Start the turn — it will race against the 120 s timeout.
    const turnPromise = sendHandler(null, 'key-1', '/tmp/cwd', 'hello', 'auto_edit', '');

    // Fast-forward 120 s to trigger the timeout.
    await vi.advanceTimersByTimeAsync(120_000);

    const result = await turnPromise;
    expect(result).toBe(false);

    const channels = win.sent.map(([ch]) => ch);
    // Must emit ai:error
    expect(channels).toContain('ai:error');
    // Must emit ai:message containing { type: 'done' }
    const doneMsg = win.sent.find(([ch, _key, msg]) => ch === 'ai:message' && msg?.type === 'done');
    expect(doneMsg).toBeDefined();

    // The error message must describe the timeout
    const errMsg = win.sent.find(([ch]) => ch === 'ai:error');
    expect(errMsg?.[2]).toMatch(/timed out/i);

    // Transport must have been disposed to prevent double-settle
    expect(fakeClient.dispose).toHaveBeenCalled();
  });

  it('does NOT emit timeout error when session/prompt responds before 120 s', async () => {
    const win = makeWindow();
    const fakeClient = makeFakeClient({ hangPrompt: false });
    mockClientFactory = () => fakeClient;

    handlers.clear();
    setupGeminiService(() => win);

    const sendHandler = handlers.get('gemini:send')!;
    const turnPromise = sendHandler(null, 'key-2', '/tmp/cwd', 'hello', 'auto_edit', '');

    // Tick just enough for promises to resolve — no timer advance needed.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const result = await turnPromise;
    expect(result).toBe(true);

    const channels = win.sent.map(([ch]) => ch);
    expect(channels).not.toContain('ai:error');
    expect(channels).toContain('ai:message');
    // done must be emitted
    const doneMsg = win.sent.find(([ch, _key, msg]) => ch === 'ai:message' && msg?.type === 'done');
    expect(doneMsg).toBeDefined();
    // transport must NOT have been disposed on success
    expect(fakeClient.dispose).not.toHaveBeenCalled();
  });
});
