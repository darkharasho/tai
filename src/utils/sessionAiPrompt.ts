import type { SegmentedBlock } from '@/types';
import { tailLines } from '@/utils/outputWindow';
import { redactSecrets } from '@/utils/redactSecrets';

const CONTEXT_TAIL_LINES = 120;

/**
 * Frame a side-conversation question with the running process as context:
 * the command, its port if known, and a redacted tail of its output.
 */
export function buildSessionAiPrompt(
  question: string,
  block: SegmentedBlock,
  port: number | null,
): string {
  const tail = tailLines(block.output || '', CONTEXT_TAIL_LINES).text;
  return [
    `The user has a long-running process in this terminal: \`${block.command}\`${port != null ? ` (listening on :${port})` : ''}.`,
    'Recent output from the process:',
    '```',
    redactSecrets(tail),
    '```',
    '',
    question,
  ].join('\n');
}
