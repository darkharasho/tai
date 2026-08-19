import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BlockSegmenter } from '@/components/BlockSegmenter';
import { parseRecording, type PtyRecording } from '@/utils/ptyRecording';
import type { SegmentedBlock } from '@/types';

export interface ReplayEvent {
  t: number;
  label: string;
}

export interface ReplayResult {
  blocks: SegmentedBlock[];
  timeline: ReplayEvent[];
  /** Labels only. The ergonomic form for assertions; flapping shows up here. */
  transitions: string[];
}

/**
 * Drive a fresh BlockSegmenter from a recording, preserving the original chunk
 * boundaries and the interleaving of out-of-band events.
 *
 * The timeline is the point of this helper. A block snapshot tells you the
 * final answer; only the transition sequence tells you the terminal flapped
 * three times on the way there, which is the failure class this corpus exists
 * to catch.
 */
export function replayRecording(rec: PtyRecording): ReplayResult {
  const seg = new BlockSegmenter();
  const blocks: SegmentedBlock[] = [];
  const timeline: ReplayEvent[] = [];
  let now = 0;

  seg.onBlock(b => blocks.push(b));
  seg.onAltScreen(entered => timeline.push({ t: now, label: `altScreen:${entered}` }));
  seg.onInteractiveMode((entered, fullscreen) => timeline.push({
    t: now,
    label: `interactive:${entered}${entered && fullscreen ? ':fullscreen' : ''}`,
  }));

  for (const entry of rec.entries) {
    now = entry.t;
    switch (entry.kind) {
      case 'data':
        seg.feed(Buffer.from(entry.d, 'base64').toString('utf8'));
        break;
      case 'termios':
        // Same mapping termiosPoller performs: !ICANON is a raw-mode program,
        // !ECHO with ICANON is the classic password-prompt shape.
        timeline.push({
          t: now,
          label: !entry.icanon ? 'termios:raw'
            : !entry.echo ? 'termios:password'
            : 'termios:cooked',
        });
        break;
      case 'resize':
        seg.onResize(entry.cols, entry.rows);
        break;
      case 'exit':
        timeline.push({ t: now, label: `exit:${entry.code}` });
        break;
    }
  }

  return { blocks, timeline, transitions: timeline.map(e => e.label) };
}

export function replayFixture(name: string): ReplayResult {
  // fileURLToPath rather than __dirname: vitest loads these as ESM, where
  // __dirname is not defined.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const file = path.join(here, '..', 'fixtures', 'pty', `${name}.jsonl`);
  return replayRecording(parseRecording(fs.readFileSync(file, 'utf8')));
}
