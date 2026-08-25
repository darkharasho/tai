import { stripAnsi } from './stripAnsi';
import type { SegmentedBlock } from '@/types';

/**
 * Wall-clock time a block started, as HH:MM. Zero-padded 24h rather than a
 * locale format: the meta row is monospace and a variable-width "2:05 PM"
 * makes a column of blocks ragged.
 */
export function formatClock(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return '';
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * A block rendered as something you can paste into an issue or a chat: the
 * command, its output with ANSI removed, and the exit code when it failed.
 * The `console` fence is what GitHub and Slack both render as a terminal.
 */
export function buildBlockTranscript(block: Pick<SegmentedBlock,
  'command' | 'output' | 'exitCode' | 'cwd'>): string {
  const lines: string[] = ['```console'];
  const dir = block.cwd ? `${block.cwd} ` : '';
  lines.push(`${dir}$ ${block.command}`);
  const body = stripAnsi(block.output ?? '').replace(/\s+$/, '');
  if (body) lines.push(body);
  lines.push('```');
  // Only worth stating when it isn't the boring answer; a clean exit is
  // already implied by output that looks fine.
  if (typeof block.exitCode === 'number' && block.exitCode !== 0) {
    lines.push('', `exit ${block.exitCode}`);
  }
  return lines.join('\n');
}
