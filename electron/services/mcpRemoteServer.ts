/**
 * Generates a self-contained Node.js MCP server script that routes Claude Code's
 * built-in tool calls (Bash, Read, Write, Edit, Grep, Glob) through the TAI daemon
 * running on a remote host via SSH.
 *
 * The script is written to /tmp and passed to claude via --mcp-config. Combined with
 * --disallowed-tools, this makes all tool execution happen on the remote machine.
 */
export function generateMcpServerScript(target: string, sshConfigPath: string): string {
  return `#!/usr/bin/env node
'use strict';
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');

const SSH_TARGET = ${JSON.stringify(target)};
const SSH_CONFIG = ${JSON.stringify(sshConfigPath)};

// --- Daemon connection ---
let daemonReady = false;
let daemonReadyResolve;
const daemonReadyPromise = new Promise(r => { daemonReadyResolve = r; });
let daemonBuf = '';
const pending = new Map();

const daemon = spawn('ssh', ['-F', SSH_CONFIG, SSH_TARGET, '~/.tai/tai-daemon', '--connect'], {
  stdio: ['pipe', 'pipe', 'pipe'],
});

daemon.stdout.on('data', chunk => {
  daemonBuf += chunk.toString();
  const lines = daemonBuf.split('\\n');
  daemonBuf = lines.pop() || '';
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.type === 'ready') { daemonReady = true; daemonReadyResolve(); continue; }
      if (msg.type === 'pong') continue;
      if (msg.id) {
        const resolve = pending.get(msg.id);
        if (resolve) { pending.delete(msg.id); resolve(msg); }
      }
    } catch {}
  }
});

daemon.stderr.on('data', chunk => process.stderr.write(chunk));
daemon.on('exit', () => process.exit(1));

function daemonCall(tool, params) {
  return new Promise(resolve => {
    const id = randomUUID();
    pending.set(id, resolve);
    daemon.stdin.write(JSON.stringify({ id, tool, params }) + '\\n');
  });
}

function extractResult(toolName, result) {
  if (!result) return { output: '', isError: false };
  if ('exitCode' in result) return { output: result.output ?? '', isError: result.exitCode !== 0 };
  if ('content' in result) return { output: result.content ?? '', isError: false };
  if ('files' in result) return { output: result.files.join('\\n'), isError: false };
  if ('output' in result) return { output: result.output ?? '', isError: false };
  return { output: JSON.stringify(result), isError: false };
}

async function executeTool(name, args) {
  if (!daemonReady) await daemonReadyPromise;
  try {
    let res;
    switch (name) {
      case 'Bash':
        res = await daemonCall('bash', { command: args.command, cwd: args.cwd, timeout: args.timeout });
        break;
      case 'Read':
        res = await daemonCall('read', { path: args.file_path, offset: args.offset, limit: args.limit });
        break;
      case 'Write':
        res = await daemonCall('write', { path: args.file_path, content: args.content });
        break;
      case 'Edit':
        res = await daemonCall('edit', { path: args.file_path, old_string: args.old_string, new_string: args.new_string, replace_all: args.replace_all });
        break;
      case 'Grep':
        res = await daemonCall('grep', { pattern: args.pattern, path: args.path, glob: args.glob, '-i': args['-i'], context: args.context });
        break;
      case 'Glob':
        res = await daemonCall('glob', { pattern: args.pattern, path: args.path });
        break;
      default:
        return { output: 'Unknown tool: ' + name, isError: true };
    }
    if (res.error) return { output: res.error, isError: true };
    return extractResult(name, res.result);
  } catch (e) {
    return { output: e.message, isError: true };
  }
}

// --- Tool definitions (schemas matching Claude Code built-ins) ---
const TOOLS = [
  {
    name: 'Bash',
    description: 'Execute a bash command on the remote host ' + SSH_TARGET,
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The bash command to run' },
        timeout: { type: 'number', description: 'Timeout in milliseconds' },
        description: { type: 'string', description: 'Description of what this command does' },
      },
      required: ['command'],
    },
  },
  {
    name: 'Read',
    description: 'Read a file on the remote host ' + SSH_TARGET,
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Absolute path to the file' },
        offset: { type: 'number', description: 'Line number to start reading from' },
        limit: { type: 'number', description: 'Number of lines to read' },
      },
      required: ['file_path'],
    },
  },
  {
    name: 'Write',
    description: 'Write a file on the remote host ' + SSH_TARGET,
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Absolute path to the file' },
        content: { type: 'string', description: 'Content to write' },
      },
      required: ['file_path', 'content'],
    },
  },
  {
    name: 'Edit',
    description: 'Edit a file on the remote host ' + SSH_TARGET,
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Absolute path to the file' },
        old_string: { type: 'string', description: 'Text to replace' },
        new_string: { type: 'string', description: 'Replacement text' },
        replace_all: { type: 'boolean', description: 'Replace all occurrences' },
      },
      required: ['file_path', 'old_string', 'new_string'],
    },
  },
  {
    name: 'Grep',
    description: 'Search files on the remote host ' + SSH_TARGET,
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Regex pattern to search for' },
        path: { type: 'string', description: 'Directory or file to search in' },
        glob: { type: 'string', description: 'Glob pattern to filter files' },
        '-i': { type: 'boolean', description: 'Case insensitive' },
        context: { type: 'number', description: 'Lines of context around matches' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'Glob',
    description: 'Find files by pattern on the remote host ' + SSH_TARGET,
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Glob pattern to match' },
        path: { type: 'string', description: 'Directory to search in' },
      },
      required: ['pattern'],
    },
  },
];

// --- MCP JSON-RPC protocol over stdio ---
let inputBuf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  inputBuf += chunk;
  const lines = inputBuf.split('\\n');
  inputBuf = lines.pop() || '';
  for (const line of lines) {
    if (!line.trim()) continue;
    try { handleRequest(JSON.parse(line)); } catch {}
  }
});

process.stdin.on('end', () => process.exit(0));

function respond(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\\n');
}

function respondError(id, code, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\\n');
}

async function handleRequest(msg) {
  const { id, method, params } = msg;

  // Notifications (no id) — ignore
  if (id === undefined || id === null) return;

  switch (method) {
    case 'initialize':
      respond(id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'tai-remote', version: '1.0.0' },
      });
      break;

    case 'ping':
      respond(id, {});
      break;

    case 'tools/list':
      respond(id, { tools: TOOLS });
      break;

    case 'tools/call': {
      const { name, arguments: args } = params;
      const result = await executeTool(name, args || {});
      respond(id, {
        content: [{ type: 'text', text: result.output }],
        isError: result.isError,
      });
      break;
    }

    default:
      respondError(id, -32601, 'Method not found: ' + method);
  }
}
`;
}

export function generateMcpConfig(serverScriptPath: string): object {
  return {
    mcpServers: {
      'tai-remote': {
        command: 'node',
        args: [serverScriptPath],
      },
    },
  };
}
