import * as fs from 'fs';
import * as net from 'net';
import type { AskpassBroker, AskpassRequest } from './askpassBroker';

const MAX_LINE = 4096;
const MAX_KEY = 200;
const MAX_PROMPT = 500;

export function parseAskpassRequest(value: unknown): AskpassRequest | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.pid !== 'number' || !Number.isInteger(v.pid) || v.pid <= 1) return null;
  // An empty key (helper run without TAI_ASKPASS_KEY) routes to no tab: refuse
  // now rather than leave sudo waiting out the prompt timeout.
  if (typeof v.key !== 'string' || v.key.length === 0 || v.key.length > MAX_KEY) return null;
  const prompt = typeof v.prompt === 'string' ? v.prompt.slice(0, MAX_PROMPT) : '';
  return { pid: v.pid, key: v.key, prompt };
}

const REFUSE = '{"ok":false}\n';

export function startAskpassServer(
  broker: Pick<AskpassBroker, 'handleRequest'>,
  socketPath: string,
): Promise<net.Server> {
  try { fs.unlinkSync(socketPath); } catch { /* not there */ }

  const server = net.createServer((sock) => {
    let buf = '';
    let received = false;
    let replied = false;
    let cancel: (() => void) | null = null;

    sock.setEncoding('utf8');
    sock.on('data', (chunk: string) => {
      if (received) return;
      buf += chunk;
      if (buf.length > MAX_LINE) { sock.destroy(); return; }
      const nl = buf.indexOf('\n');
      if (nl < 0) return;
      received = true;

      let parsed: unknown = null;
      try { parsed = JSON.parse(buf.slice(0, nl)); } catch { /* malformed */ }
      const req = parseAskpassRequest(parsed);
      if (!req) { replied = true; sock.end(REFUSE); return; }

      cancel = broker.handleRequest(req, (reply) => {
        replied = true;
        if (!sock.destroyed) sock.end(JSON.stringify(reply) + '\n');
      });
    });
    sock.on('close', () => { if (!replied) cancel?.(); });
    sock.on('error', () => { /* close follows */ });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => {
      server.off('error', reject);
      // Keep a listener so a later server error cannot crash the main process.
      // Log the message only: requests and replies never reach this path.
      server.on('error', (err) => { console.warn('[askpass] server error:', err.message); });
      try { fs.chmodSync(socketPath, 0o600); } catch { /* dir is 0700 anyway */ }
      resolve(server);
    });
  });
}
