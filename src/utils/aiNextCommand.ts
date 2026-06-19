export function buildNextCommandPrompt(ctx: { lastCommand: string; recentCommands: string[]; cwd?: string }): string {
  const recent = ctx.recentCommands.slice(-10).join('\n');
  return [
    'You are a shell next-command predictor. Given the last command and recent history,',
    'reply with ONLY the single most likely next shell command, in a ```bash code block.',
    ctx.cwd ? `Current directory: ${ctx.cwd}` : '',
    `Last command: ${ctx.lastCommand}`,
    `Recent commands:\n${recent}`,
  ].filter(Boolean).join('\n');
}

const FENCE_RE = /```(?:bash|sh|shell)?\n([\s\S]*?)```/;

export function extractCommand(aiText: string): string | null {
  if (!aiText || !aiText.trim()) return null;
  const fenced = aiText.match(FENCE_RE);
  const candidate = (fenced ? fenced[1] : aiText).trim().split('\n')[0]?.trim();
  return candidate && !candidate.startsWith('#') ? candidate : null;
}
