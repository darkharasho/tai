/**
 * End-to-end regression test for the generated MCP history server script.
 *
 * Regression: the embedded formatter function was previously injected via
 * `${fn.toString()}` alone, which means under bundler minification the
 * function name changed (e.g. to `Qe`) while the static call site kept
 * `formatHistoryEntries(...)`, causing ReferenceError on every tools/call.
 *
 * This test spawns the generated script as a real Node process and sends
 * MCP JSON-RPC messages over stdio, asserting that a tools/call response
 * contains the expected formatted text and NOT an error.
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { generateHistoryServerScript } from '../../electron/services/mcpHistoryServer';

function sendMcpMessages(scriptPath: string, messages: object[]): object[] {
  const input = messages.map(m => JSON.stringify(m)).join('\n') + '\n';
  const result = spawnSync('node', [scriptPath], {
    input,
    encoding: 'utf8',
    timeout: 10000,
  });
  if (result.error) throw result.error;
  const lines = result.stdout.split('\n').filter(l => l.trim());
  return lines.map(l => JSON.parse(l));
}

describe('generateHistoryServerScript (end-to-end)', () => {
  const tmpFiles: string[] = [];

  afterEach(() => {
    for (const f of tmpFiles) {
      try { fs.unlinkSync(f); } catch {}
    }
    tmpFiles.length = 0;
  });

  it('tools/call TerminalHistory returns formatted history — not a ReferenceError', () => {
    // Write a history JSON file with one entry
    const historyFile = path.join(os.tmpdir(), `tai-test-history-${process.pid}.json`);
    tmpFiles.push(historyFile);
    const entry = {
      command: 'echo hello-from-regression-test',
      output: 'hello-from-regression-test',
      exitCode: 0,
      cwd: '/tmp',
    };
    fs.writeFileSync(historyFile, JSON.stringify([entry]));

    // Generate the MCP server script and write it as a .cjs file
    const scriptContent = generateHistoryServerScript(historyFile);
    const scriptFile = path.join(os.tmpdir(), `tai-test-mcp-${process.pid}.cjs`);
    tmpFiles.push(scriptFile);
    fs.writeFileSync(scriptFile, scriptContent);

    // Send initialize + tools/call over stdin
    const responses = sendMcpMessages(scriptFile, [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {} } },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'TerminalHistory', arguments: { count: 5 } } },
    ]);

    expect(responses).toHaveLength(2);

    // initialize response
    expect(responses[0]).toMatchObject({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2024-11-05' } });

    // tools/call response — must NOT be an error, must contain the command text
    const callResp = responses[1] as any;
    expect(callResp.id).toBe(2);
    expect(callResp.error).toBeUndefined();
    expect(callResp.result).toBeDefined();
    expect(callResp.result.isError).toBe(false);
    const text: string = callResp.result.content[0].text;
    expect(text).toContain('echo hello-from-regression-test');
    expect(text).toContain('hello-from-regression-test');
  });

  it('tools/call with empty history returns placeholder text', () => {
    const historyFile = path.join(os.tmpdir(), `tai-test-history-empty-${process.pid}.json`);
    tmpFiles.push(historyFile);
    fs.writeFileSync(historyFile, JSON.stringify([]));

    const scriptContent = generateHistoryServerScript(historyFile);
    const scriptFile = path.join(os.tmpdir(), `tai-test-mcp-empty-${process.pid}.cjs`);
    tmpFiles.push(scriptFile);
    fs.writeFileSync(scriptFile, scriptContent);

    const responses = sendMcpMessages(scriptFile, [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {} } },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'TerminalHistory', arguments: {} } },
    ]);

    const callResp = responses[1] as any;
    expect(callResp.error).toBeUndefined();
    expect(callResp.result.isError).toBe(false);
    expect(callResp.result.content[0].text).toBe('No terminal history available.');
  });

  it('generated script contains stable const binding for formatHistoryEntries', () => {
    const scriptContent = generateHistoryServerScript('/tmp/dummy.json');
    // The fix: the embedded function must be bound to a stable name via `const formatHistoryEntries = ...`
    // NOT just the raw fn.toString() which would produce a possibly-minified function name.
    expect(scriptContent).toMatch(/const formatHistoryEntries\s*=\s*function/);
    // The call site must also be present
    expect(scriptContent).toContain('formatHistoryEntries(entries)');
  });
});
