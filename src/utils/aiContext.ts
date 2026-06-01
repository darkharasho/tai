import type { DisplayItem } from '@/components/BlockList';

export interface RecentContextOptions {
  maxCommands?: number;
  maxOutputChars?: number;
  budgetChars?: number;
}

export interface RecentContextResult {
  text: string;
  lastId: string | null;
}

const DEFAULTS = { maxCommands: 5, maxOutputChars: 800, budgetChars: 1500 };

type CommandItem = DisplayItem & { type: 'command' };

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + `\n… (${s.length - max} chars truncated)`;
}

function isFailed(c: CommandItem): boolean {
  return c.block.exitCode !== undefined && c.block.exitCode !== 0;
}

export function buildRecentContext(
  items: DisplayItem[],
  sinceId: string | null,
  status?: { cwd?: string; gitBranch?: string | null },
  opts: RecentContextOptions = {},
): RecentContextResult {
  const maxCommands = opts.maxCommands ?? DEFAULTS.maxCommands;
  const maxOutputChars = opts.maxOutputChars ?? DEFAULTS.maxOutputChars;
  const budgetChars = opts.budgetChars ?? DEFAULTS.budgetChars;

  const commands = items.filter(
    (it): it is CommandItem => it.type === 'command' && !it.active,
  );

  let startIdx = 0;
  if (sinceId) {
    const idx = commands.findIndex(c => c.block.id === sinceId);
    startIdx = idx === -1 ? 0 : idx + 1;
  }
  const fresh = commands.slice(startIdx);
  const lastId = commands.length ? commands[commands.length - 1].block.id : sinceId;

  if (fresh.length === 0) return { text: '', lastId };

  const selected = fresh.slice(-maxCommands);
  const entries = selected.map((c, i) => ({
    cmd: c,
    withOutput: i === selected.length - 1 || isFailed(c),
  }));

  const renderLine = (c: CommandItem, withOutput: boolean): string => {
    const exit = c.block.exitCode;
    const exitStr = exit !== undefined && exit !== 0 ? `  [exit ${exit}]` : '';
    let line = `$ ${c.block.command}${exitStr}`;
    if (withOutput && c.block.output && c.block.output.trim()) {
      line += '\n' + truncate(c.block.output.trim(), maxOutputChars);
    }
    return line;
  };

  const render = (): string => {
    const head = status?.cwd
      ? `cwd: ${status.cwd}${status.gitBranch ? ` (git: ${status.gitBranch})` : ''}`
      : '';
    const body = entries.map(e => renderLine(e.cmd, e.withOutput));
    return [head, 'recent terminal activity:', ...body].filter(Boolean).join('\n');
  };

  for (let i = 0; i < entries.length && render().length > budgetChars; i++) {
    entries[i].withOutput = false;
  }
  while (entries.length > 1 && render().length > budgetChars) {
    entries.shift();
  }

  return { text: render(), lastId };
}
