import type { SegmentedBlock } from '@/types';

/**
 * A raw-mode flip mid-command (vite's keyboard shortcuts, interactive
 * installers) can leave the segmenter's finalized block with empty output
 * while the streamed pending card had plenty. Never throw away output the
 * user already saw: fall back to the streamed text when finalize is blank.
 */
export function preserveStreamedOutput(
  block: SegmentedBlock,
  streamed: { output?: string; rawOutput?: string } | null,
): SegmentedBlock {
  if (block.output?.trim()) return block;
  if (!streamed?.output?.trim()) return block;
  return {
    ...block,
    output: streamed.output,
    rawOutput: streamed.rawOutput?.trim() ? streamed.rawOutput : streamed.output,
  };
}
