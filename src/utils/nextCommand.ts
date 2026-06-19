// src/utils/nextCommand.ts
import { CommandIndex, topNext } from '@/utils/commandIndex';

// Curated chain rules: a matcher on the just-run command → the likely next.
// Ordered; first match wins. Keep this small and high-confidence.
const CHAIN_RULES: { test: (cmd: string) => boolean; next: string }[] = [
  { test: (c) => /^git\s+add\b/.test(c), next: 'git commit' },
  { test: (c) => /^git\s+commit\b/.test(c), next: 'git push' },
  { test: (c) => /^git\s+clone\b/.test(c), next: 'cd ' },
  { test: (c) => /^cd\s+\S/.test(c), next: 'git status' },
  { test: (c) => /^mkdir\s+(\S+)/.test(c), next: 'cd ' },
  { test: (c) => /^npm\s+(i|install)\b/.test(c), next: 'npm run dev' },
  { test: (c) => /^docker\s+build\b/.test(c), next: 'docker run' },
];

export interface NextCommandCtx {
  lastCommand: string;
  lastExitCode?: number;
  index: CommandIndex;
}

export function predictNextCommand(ctx: NextCommandCtx): string | null {
  const cmd = ctx.lastCommand?.trim();
  if (!cmd) return null;
  if (ctx.lastExitCode !== undefined && ctx.lastExitCode !== 0) return null; // failure → ErrorAffordance

  for (const rule of CHAIN_RULES) {
    if (rule.test(cmd)) return rule.next;
  }
  const co = topNext(ctx.index, cmd, 1);
  return co.length > 0 ? co[0] : null;
}
