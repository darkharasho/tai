import type { SessionKind } from '@/utils/sessionKind';

/** One-line summary for a finished session's collapsed card. */
export function summarizeSession(kind: SessionKind, output: string, port: number | null): string {
  const lineCount = output ? output.split('\n').length : 0;
  const parts: string[] = [];
  if (kind === 'agent') parts.push('agent session');
  if (port != null) parts.push(`:${port}`);
  parts.push(`${lineCount.toLocaleString('en-US')} lines`);
  return parts.join(' · ');
}
