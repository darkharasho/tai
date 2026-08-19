import { describe, it, expect } from 'vitest';
import { BlockSegmenter } from '@/components/BlockSegmenter';
import type { ModeState } from '@/utils/terminalMode';

const DEGRADED: ModeState = {
  inputOwner: 'shell', provenance: 'degraded', degradedReason: 'no-hooks',
  passwordPrompt: false, commandRunning: true,
};

describe('degraded segmentation', () => {
  it('does not split a block on a speculative prompt match', () => {
    // A remote shell with no integration. `$` at the end of a line of output is
    // not proof of a prompt, and attributing the following output to a
    // fabricated command is a lie that propagates into AI context, re-run and
    // session restore. Under-segmenting is merely ugly.
    const seg = new BlockSegmenter();
    const blocks: any[] = [];
    seg.onBlock(b => blocks.push(b));
    seg.setModeState(DEGRADED);

    seg.feed('user@remote:~$ ');
    seg.feed('cat prices.txt\n');
    seg.feed('widget costs 5$\n');
    seg.feed('gadget costs 9$\n');

    // The `5$` line must not be treated as a prompt and split the block.
    expect(blocks.length).toBeLessThanOrEqual(1);
    // The assertion above is satisfied by a segmenter that emits nothing ever,
    // and in fact holds without the guard too (the un-degraded run below also
    // emits exactly one block). This is the one that actually pins the change:
    // nothing is split off at all, so the `cat` output is still owned by the
    // live block instead of being sealed into a finished one.
    expect(blocks).toHaveLength(0);
  });

  // The exact mis-segmentation the guard exists to stop, pinned on the SAME
  // feed with the guard inactive — the two tests together isolate the guard
  // from "the segmenter stopped working".
  it('is the guard, not silence: the same feed mis-segments when not degraded', () => {
    const seg = new BlockSegmenter();
    const blocks: any[] = [];
    const prompts: string[] = [];
    seg.onBlock(b => blocks.push(b));
    seg.onPromptChange(p => prompts.push(p));

    seg.feed('user@remote:~$ ');
    seg.feed('cat prices.txt\n');
    seg.feed('widget costs 5$\n');
    seg.feed('gadget costs 9$\n');

    // `cat prices.txt` is declared finished the instant a line of its own
    // output ends in `$` — with none of that output attached, because the
    // line that triggered it was consumed as the next prompt. Everything
    // after it is then attributed to a command that was never run.
    expect(blocks).toHaveLength(1);
    expect(blocks[0].command).toBe('cat prices.txt');
    expect(blocks[0].output).toBe('');
    expect(prompts).toContain('widget costs 5$');
  });

  it('still segments normally when not degraded', () => {
    const seg = new BlockSegmenter();
    const blocks: any[] = [];
    seg.onBlock(b => blocks.push(b));

    seg.feed('user@host:~$ ');
    seg.feed('echo one\n');
    seg.feed('one\n');
    seg.feed('user@host:~$ ');

    expect(blocks).toHaveLength(1);
    expect(blocks[0].command).toBe('echo one');
  });

  // Under-segmenting, not un-segmenting: the strong branch (a prompt match on
  // the PARTIAL line, i.e. the cursor is sitting right after it) is untouched,
  // so a degraded remote session still produces blocks — just fewer of them.
  it('keeps the strong prompt branch while degraded', () => {
    const seg = new BlockSegmenter();
    const blocks: any[] = [];
    seg.onBlock(b => blocks.push(b));
    seg.setModeState(DEGRADED);

    seg.feed('user@remote:~$ ');
    seg.feed('echo one\n');
    seg.feed('one\n');
    seg.feed('user@remote:~$ ');

    expect(blocks).toHaveLength(1);
    expect(blocks[0].command).toBe('echo one');
  });
});
