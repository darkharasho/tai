import { BrowserWindow, ipcMain } from 'electron';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { createGeminiAcpClient } from './gemini-acp';
import type { GeminiAcpClient } from './gemini-acp';
import { enrichEnv } from './platform';
import { IDLE_TIMEOUT_MS } from './idleWatchdog';

function enrichedEnv(): Record<string, string> {
  return enrichEnv();
}

function safeSend(win: BrowserWindow | null, channel: string, ...args: unknown[]) {
  try {
    if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
  } catch { /* window destroyed */ }
}

const BOOTSTRAP_FILES = ['README.md', 'package.json', 'GEMINI.md', 'CLAUDE.md', 'tsconfig.json'];

function readFileSnippet(filePath: string, maxChars: number): string | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, 'utf8').slice(0, maxChars).trim();
  } catch {
    return null;
  }
}

function collectProjectPaths(rootPath: string, maxEntries: number, maxDepth: number): string[] {
  const results: string[] = [];

  function visit(currentPath: string, depth: number) {
    if (results.length >= maxEntries || depth > maxDepth) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentPath, { withFileTypes: true });
    } catch { return; }

    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (results.length >= maxEntries) return;
      if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'dist-electron') continue;
      const absolutePath = path.join(currentPath, entry.name);
      const relativePath = path.relative(rootPath, absolutePath) || '.';
      results.push(entry.isDirectory() ? `${relativePath}/` : relativePath);
      if (entry.isDirectory()) visit(absolutePath, depth + 1);
    }
  }

  visit(rootPath, 0);
  return results;
}

function buildProjectBootstrap(rootPath: string): string {
  const topLevel = (() => {
    try {
      return fs.readdirSync(rootPath).sort().slice(0, 40).join('\n');
    } catch { return ''; }
  })();

  const projectPaths = collectProjectPaths(rootPath, 120, 2).join('\n');
  const fileSnippets = BOOTSTRAP_FILES
    .map((name) => {
      const snippet = readFileSnippet(path.join(rootPath, name), 2000);
      if (!snippet) return null;
      return `## ${name}\n${snippet}`;
    })
    .filter(Boolean)
    .join('\n\n');

  return [
    'Project bootstrap context for this repository.',
    'Use it as orientation for future edits and suggestions.',
    'Do not answer this message or summarize it back.',
    '',
    `Repository root: ${rootPath}`,
    '',
    topLevel ? `Top-level entries:\n${topLevel}` : '',
    projectPaths ? `Shallow project map:\n${projectPaths}` : '',
    fileSnippets ? `Key file snippets:\n${fileSnippets}` : '',
  ].filter(Boolean).join('\n');
}

function renderToolContent(content: any[] | undefined): string {
  if (!Array.isArray(content) || content.length === 0) return '';
  return content.map((item) => {
    if (item?.type === 'content' && item.content?.type === 'text') return item.content.text || '';
    if (item?.type === 'diff') return JSON.stringify(item);
    return JSON.stringify(item);
  }).filter(Boolean).join('\n');
}

function sanitizeInput(input: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [k, v] of Object.entries(input)) {
    if (v == null) continue;
    result[k] = typeof v === 'object' ? JSON.stringify(v) : v;
  }
  return result;
}

function mapGeminiToolName(kind: string | undefined, title: string | undefined): string {
  switch (kind) {
    case 'shell': return 'Bash';
    case 'edit': case 'file_edit': return 'Edit';
    case 'read': case 'file_read': return 'Read';
    case 'write': case 'file_write': return 'Write';
    case 'search': return 'Grep';
    case 'glob': return 'Glob';
    case 'web_fetch': return 'WebFetch';
    case 'web_search': return 'WebSearch';
    default: return title || kind || 'tool';
  }
}

function extractLocationPath(loc: unknown): string {
  if (typeof loc === 'string') return loc;
  if (loc && typeof loc === 'object' && 'path' in loc) return String((loc as any).path);
  return '';
}

function buildGeminiToolInput(update: any): Record<string, any> {
  const kind = update.kind;
  const rawLocations: unknown[] = Array.isArray(update.locations) ? update.locations : [];
  const loc = extractLocationPath(rawLocations[0]);

  switch (kind) {
    case 'shell':
      return { command: update.title || loc || '' };
    case 'edit': case 'file_edit':
    case 'read': case 'file_read':
    case 'write': case 'file_write':
      return { file_path: loc || update.title || '' };
    case 'search':
      return { pattern: update.title || '', ...(loc ? { path: loc } : {}) };
    case 'glob':
      return { pattern: loc || update.title || '' };
    default: {
      const locations = rawLocations.map(l => extractLocationPath(l)).filter(Boolean);
      return { kind, ...(locations.length ? { locations } : {}) };
    }
  }
}

export function translateGeminiEvent(msg: any, projectPath: string): any | null {
  if (msg?.method === 'session/update') {
    const update = msg.params?.update;
    if (update?.sessionUpdate === 'agent_message_chunk') {
      return {
        type: 'assistant',
        projectPath,
        message: {
          content: [{
            type: 'text',
            text: update.content?.text || '',
            delta: true,
          }],
        },
      };
    }

    if (update?.sessionUpdate === 'tool_call') {
      const name = mapGeminiToolName(update.kind, update.title);
      const input = buildGeminiToolInput(update);
      return {
        type: 'assistant',
        projectPath,
        message: {
          content: [{
            id: update.toolCallId,
            type: 'tool_use',
            name,
            input,
          }],
        },
      };
    }

    if (update?.sessionUpdate === 'tool_call_update') {
      return {
        type: 'user',
        projectPath,
        message: {
          content: [{
            type: 'tool_result',
            tool_use_id: update.toolCallId,
            content: renderToolContent(update.content),
            is_error: update.status === 'failed',
          }],
        },
      };
    }

    return null;
  }

  if (msg?.method === 'message/assistant') {
    return {
      type: 'assistant',
      projectPath,
      message: {
        content: [{
          type: 'text',
          text: msg.params?.text || '',
          delta: !!msg.params?.delta,
        }],
      },
    };
  }

  if (msg?.method === 'tool/call') {
    const input = msg.params?.input || {};
    return {
      type: 'assistant',
      projectPath,
      message: {
        content: [{
          id: msg.params?.id,
          type: 'tool_use',
          name: msg.params?.name || 'tool',
          input: sanitizeInput(input),
        }],
      },
    };
  }

  if (msg?.method === 'tool/result') {
    return {
      type: 'user',
      projectPath,
      message: {
        content: [{
          type: 'tool_result',
          tool_use_id: msg.params?.id,
          content: msg.params?.output || '',
          is_error: !!msg.params?.isError,
        }],
      },
    };
  }

  return null;
}

interface PendingPermission {
  requestId: number;
  toolName: string;
  command: string;
  options: Array<{ optionId: string; name: string; kind: string }>;
}

interface GeminiState {
  transport: GeminiAcpClient | null;
  sessionId: string | null;
  cwd: string;
  busy: boolean;
  availability: 'available' | 'disabled';
  lastError: string | undefined;
  pendingApproval: { toolUseId: string; toolName: string; input: any } | null;
  pendingPermission: PendingPermission | null;
  bootstrapped: boolean;
}

const geminiStates = new Map<string, GeminiState>();

function getState(key: string): GeminiState {
  let state = geminiStates.get(key);
  if (!state) {
    state = {
      transport: null,
      sessionId: null,
      cwd: '',
      busy: false,
      availability: 'available',
      lastError: undefined,
      pendingApproval: null,
      pendingPermission: null,
      bootstrapped: false,
    };
    geminiStates.set(key, state);
  }
  return state;
}

function disableGemini(win: BrowserWindow | null, key: string, state: GeminiState, reason: string) {
  state.transport?.dispose();
  state.transport = null;
  state.sessionId = null;
  state.availability = 'disabled';
  state.lastError = reason;
  state.busy = false;
  state.pendingApproval = null;
  state.pendingPermission = null;
  state.bootstrapped = false;
  safeSend(win, 'ai:message', key, { type: 'error', text: `Gemini unavailable: ${reason}` });
  safeSend(win, 'ai:message', key, { type: 'done' });
}

async function ensureTransport(win: BrowserWindow | null, key: string, state: GeminiState): Promise<GeminiAcpClient> {
  if (state.transport) return state.transport;

  const client = createGeminiAcpClient({
    cwd: state.cwd,
    env: enrichedEnv(),
    clientInfo: { name: 'tai', version: '1.0' },
  });

  client.onStderr((text) => {
    safeSend(win, 'ai:message', key, { type: 'error', text: `Gemini: ${text}` });
  });

  client.onEvent((event: any) => {
    if (event?.method === 'session/request_permission') {
      const params = event.params || {};
      const options: Array<{ optionId: string; name: string; kind: string }> = Array.isArray(params.options) ? params.options : [];
      const firstOption = options[0];
      const toolName = firstOption?.name || 'Permission Request';
      const command = firstOption?.name || 'Gemini needs permission to proceed';
      const requestId = typeof event.id === 'number' ? event.id : -1;

      state.pendingPermission = { requestId, toolName, command, options };

      const approvalId = `perm-${requestId}`;
      safeSend(win, 'ai:message', key, {
        type: 'approval_needed',
        toolUseId: approvalId,
        toolName,
        command,
      });
      return;
    }

    if (event?.method === 'tool.approvalRequired' || event?.method === 'tool/approvalRequired') {
      const input = event.params?.input || {};
      const safe = sanitizeInput(input);
      state.pendingApproval = {
        toolUseId: event.params?.id || '',
        toolName: event.params?.name || 'tool',
        input: safe,
      };
      safeSend(win, 'ai:message', key, {
        type: 'approval_needed',
        toolUseId: event.params?.id || '',
        toolName: event.params?.name || 'tool',
        command: String(input.command || input.file_path || JSON.stringify(input)),
        description: event.params?.description || '',
        input,
      });
      return;
    }

    try {
      const translated = translateGeminiEvent(event, state.cwd);
      if (translated) {
        safeSend(win, 'ai:message', key, translated);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown error';
      safeSend(win, 'ai:message', key, { type: 'error', text: `Event translation error: ${msg}` });
    }
  });

  await client.start();
  state.transport = client;
  state.availability = 'available';
  state.lastError = undefined;
  return client;
}

async function ensureSession(win: BrowserWindow | null, key: string, state: GeminiState): Promise<string> {
  const client = await ensureTransport(win, key, state);

  if (state.sessionId) return state.sessionId;

  const result = await client.request<{ sessionId: string }>('session/new', {
    cwd: state.cwd,
    mcpServers: [],
  });
  state.sessionId = result.sessionId;
  safeSend(win, 'ai:message', key, { type: 'session_id', sessionId: result.sessionId });
  return result.sessionId;
}

export function setupGeminiService(getWindow: () => BrowserWindow | null) {
  ipcMain.handle('gemini:send', async (_event, key: string, cwd: string, message: string, approvalMode: string, model: string) => {
    const win = getWindow();
    const state = getState(key);
    state.cwd = cwd;

    if (state.availability === 'disabled') {
      state.availability = 'available';
      state.lastError = undefined;
    }

    try {
      const client = await ensureTransport(win, key, state);
      const sessionId = await ensureSession(win, key, state);
      const bootstrapText = state.bootstrapped ? undefined : buildProjectBootstrap(cwd);

      state.busy = true;
      safeSend(win, 'ai:message', key, { type: 'streaming_start' });

      const prompt: Array<Record<string, unknown>> = [];
      if (bootstrapText) {
        prompt.push({ type: 'text', text: bootstrapText });
      }
      prompt.push({ type: 'text', text: message });

      let settled = false;
      let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

      const timeoutPromise = new Promise<never>((_resolve, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new Error(`__gemini_timeout__`));
        }, IDLE_TIMEOUT_MS);
      });

      let result: any;
      try {
        result = await Promise.race([
          client.request<any>('session/prompt', {
            sessionId,
            prompt,
            approvalMode: approvalMode || 'auto_edit',
            model: model || undefined,
          }),
          timeoutPromise,
        ]);
      } catch (raceError) {
        if (timeoutHandle) { clearTimeout(timeoutHandle); timeoutHandle = null; }
        if (!settled) {
          settled = true;
          state.busy = false;
          if (raceError instanceof Error && raceError.message === '__gemini_timeout__') {
            // Abort the in-flight ACP request by disposing the transport so a
            // late response cannot double-settle.
            state.transport?.dispose();
            state.transport = null;
            state.sessionId = null;
            state.bootstrapped = false;
            safeSend(win, 'ai:error', key, 'AI provider timed out (no response for 120s).');
            safeSend(win, 'ai:message', key, { type: 'done' });
          } else {
            disableGemini(win, key, state, raceError instanceof Error ? raceError.message : 'Gemini request failed');
          }
        }
        return false;
      }

      if (timeoutHandle) { clearTimeout(timeoutHandle); timeoutHandle = null; }
      if (settled) return false; // timeout won the race simultaneously
      settled = true;

      if (bootstrapText) state.bootstrapped = true;

      state.busy = false;
      safeSend(win, 'ai:message', key, {
        type: 'result',
        usage: {
          input_tokens: result?.usage?.input_tokens || 0,
          cache_read_input_tokens: result?.usage?.cached || 0,
          cache_creation_input_tokens: 0,
          output_tokens: result?.usage?.output_tokens || 0,
        },
      });
      safeSend(win, 'ai:message', key, { type: 'done' });
      return true;
    } catch (error) {
      disableGemini(win, key, state, error instanceof Error ? error.message : 'Gemini request failed');
      return false;
    }
  });

  ipcMain.on('gemini:stop', async (_event, key: string) => {
    const state = getState(key);
    if (state.transport && state.sessionId && state.busy) {
      try {
        await state.transport.request('session/cancel', { sessionId: state.sessionId });
      } catch { /* ignore cancellation failures */ }
    }
    state.busy = false;
    safeSend(getWindow(), 'ai:message', key, { type: 'done' });
  });

  ipcMain.handle('gemini:approve', async (_event, key: string, toolUseId: string, approved: boolean) => {
    const state = getState(key);
    if (!state.transport) return false;

    // Handle session/request_permission responses
    if (state.pendingPermission && toolUseId.startsWith('perm-')) {
      const perm = state.pendingPermission;
      state.pendingPermission = null;
      if (approved && perm.options.length > 0) {
        const chosen = perm.options.find(o => o.kind === 'allow_once') || perm.options[0];
        state.transport.respond(perm.requestId, { optionId: chosen.optionId });
      } else {
        const deny = perm.options.find(o => o.kind === 'deny' || o.kind === 'deny_once');
        state.transport.respond(perm.requestId, { optionId: deny?.optionId || 'deny' });
      }
      return true;
    }

    // Handle tool.approvalRequired responses
    if (!state.pendingApproval) return false;
    try {
      await state.transport.request('tool/approve', {
        id: toolUseId,
        approved,
      });
      state.pendingApproval = null;
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.on('gemini:setSessionId', (_event, key: string, sessionId: string | undefined) => {
    const state = getState(key);
    state.sessionId = sessionId || null;
    state.bootstrapped = false;
  });
}

export function destroyAllGemini() {
  for (const state of geminiStates.values()) {
    state.transport?.dispose();
  }
  geminiStates.clear();
}
