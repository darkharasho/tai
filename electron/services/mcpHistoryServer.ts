import { formatHistoryEntries } from './historyFormat';

/**
 * Generates a self-contained Node.js MCP server script that exposes a
 * TerminalHistory tool.  The tool reads a JSON file maintained by the
 * TAI Electron main process that contains the most recent terminal
 * commands and their output for the current session.
 *
 * The script is written to /tmp and passed to Claude via --mcp-config.
 */
export function generateHistoryServerScript(historyFilePath: string): string {
  return `#!/usr/bin/env node
'use strict';
const fs = require('fs');

const HISTORY_FILE = ${JSON.stringify(historyFilePath)};

const TOOLS = [
  {
    name: 'TerminalHistory',
    description: 'Retrieve the recent terminal commands and their output from the current TAI session. Call this tool when you need context about what the user has been doing in the terminal — for example when they reference a previous command, error, or output. You can request a specific number of recent commands (default 10, max 50).',
    inputSchema: {
      type: 'object',
      properties: {
        count: { type: 'number', description: 'Number of recent commands to return (default 10, max 50)' },
      },
    },
  },
];

function readHistory(count) {
  try {
    const data = fs.readFileSync(HISTORY_FILE, 'utf8');
    const entries = JSON.parse(data);
    if (!Array.isArray(entries)) return [];
    const n = Math.min(Math.max(count || 10, 1), 50);
    return entries.slice(-n);
  } catch {
    return [];
  }
}

${formatHistoryEntries.toString()}

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
  if (id === undefined || id === null) return;

  switch (method) {
    case 'initialize':
      respond(id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'tai-history', version: '1.0.0' },
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
      if (name === 'TerminalHistory') {
        const entries = readHistory(args?.count);
        const text = formatHistoryEntries(entries);
        respond(id, { content: [{ type: 'text', text }], isError: false });
      } else {
        respond(id, { content: [{ type: 'text', text: 'Unknown tool: ' + name }], isError: true });
      }
      break;
    }

    default:
      respondError(id, -32601, 'Method not found: ' + method);
  }
}
`;
}

export function generateHistoryMcpConfig(serverScriptPath: string): object {
  return {
    mcpServers: {
      'tai-history': {
        command: 'node',
        args: [serverScriptPath],
      },
    },
  };
}
