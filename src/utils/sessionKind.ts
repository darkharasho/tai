/**
 * Session classification for the input-morph model: long-running processes
 * (dev servers, watchers, agent CLIs) root the input into their card instead
 * of leaving a disabled composer below an anonymous streaming block.
 */
export type SessionKind = 'oneshot' | 'server' | 'watch' | 'agent';

/** Unknown commands still alive after this long get rooted as a session. */
export const LONG_RUN_PROMOTE_MS = 10_000;

const AGENT_CLIS = new Set(['claude', 'codex', 'gemini']);

const SERVER_FIRST_WORDS = new Set(['vite', 'puma', 'rackup', 'webpack-dev-server']);

// command-start patterns, checked after wrapper stripping
const SERVER_RES: RegExp[] = [
  /^rails\s+s(erver)?\b/,
  /^(npm|yarn|pnpm|bun)\s+(run\s+)?(dev|start|serve|preview)\b/,
  /^next\s+(dev|start)\b/,
  /^python3?\s+(-m\s+)?(http\.server|flask)\b/,
  /^flask\s+run\b/,
  /^php\s+-S\b/,
  /^docker(\s+|-)compose\s+up\b/,
  /^(\.\/)?manage\.py\s+runserver\b/,
];

const WATCH_RES: RegExp[] = [
  /^tail\s+.*-[a-zA-Z]*f/,
  /^watch\b/,
  /^journalctl\s+.*-[a-zA-Z]*f/,
  /^kubectl\s+logs\s+.*-[a-zA-Z]*f/,
  /^(npm|yarn|pnpm|bun)\s+(run\s+)?watch\b/,
  /^cargo\s+watch\b/,
  /^while\s+/,
];

/** Strip sudo/env-assignment/bundle-exec/npx prefixes to find the real command. */
function stripWrappers(command: string): string {
  let c = command.trim();
  for (;;) {
    const next = c
      .replace(/^sudo\s+/, '')
      .replace(/^env\s+/, '')
      .replace(/^[A-Z_][A-Z0-9_]*=\S*\s+/, '')
      .replace(/^bundle\s+exec\s+/, '')
      .replace(/^npx\s+/, '');
    if (next === c) return c;
    c = next;
  }
}

export function classifySessionCommand(command: string): SessionKind {
  const c = stripWrappers(command);
  if (!c) return 'oneshot';
  const first = c.split(/\s+/, 1)[0];
  if (AGENT_CLIS.has(first)) return 'agent';
  if (SERVER_FIRST_WORDS.has(first)) return 'server';
  if (SERVER_RES.some(re => re.test(c))) return 'server';
  if (WATCH_RES.some(re => re.test(c))) return 'watch';
  return 'oneshot';
}

/**
 * Should the active block become the rooted input surface? Servers and
 * watchers morph immediately; agents never do (their raw-mode TUI already
 * drives the docked surface); unknown commands get promoted once they've
 * clearly become long-running.
 */
export function shouldRootSession(kind: SessionKind, elapsedMs: number): boolean {
  if (kind === 'server' || kind === 'watch') return true;
  if (kind === 'agent') return false;
  return elapsedMs >= LONG_RUN_PROMOTE_MS;
}

const PORT_RE = /(?:localhost|127\.0\.0\.1|0\.0\.0\.0)[.:](\d{2,5})/;

/** First local port mentioned in output — the card's click-to-open chip. */
export function detectPort(output: string): number | null {
  const m = output.match(PORT_RE);
  return m ? parseInt(m[1], 10) : null;
}
