// Active-command output is stored in full for copy/AI even though only a window
// renders. Bound the stored buffer so a runaway command can't exhaust memory.
export const MAX_STORED_OUTPUT_CHARS = 1_000_000;

export function clampStoredOutput(s: string, max: number = MAX_STORED_OUTPUT_CHARS): string {
  if (s.length <= max) return s;
  const dropped = s.length - max;
  return `…[${dropped} earlier chars truncated]\n` + s.slice(s.length - max);
}
