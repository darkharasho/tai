import { describe, it, expect, vi } from 'vitest';
import { BlockSegmenter } from '@/components/BlockSegmenter';

describe('BlockSegmenter', () => {
  it('detects a prompt and fires onBlock after command completes', () => {
    const segmenter = new BlockSegmenter();
    const blockCb = vi.fn();
    segmenter.onBlock(blockCb);

    segmenter.feed('user@host:~$ ');
    expect(segmenter.seenFirstPrompt).toBe(true);

    segmenter.feed('ls\nfile1.txt\nfile2.txt\n');
    segmenter.feed('user@host:~$ ');

    expect(blockCb).toHaveBeenCalledTimes(1);
    const block = blockCb.mock.calls[0][0];
    expect(block.command).toBe('ls');
    expect(block.output).toContain('file1.txt');
  });

  it('fires onOutput with incremental output', () => {
    const segmenter = new BlockSegmenter();
    const outputCb = vi.fn();
    segmenter.onOutput(outputCb);

    segmenter.feed('user@host:~$ ');
    segmenter.feed('echo hello\nhello\n');

    expect(outputCb).toHaveBeenCalled();
  });

  it('detects alt-screen enter/exit', () => {
    const segmenter = new BlockSegmenter();
    const altCb = vi.fn();
    segmenter.onAltScreen(altCb);

    segmenter.feed('\x1b[?1049h');
    expect(altCb).toHaveBeenCalledWith(true);

    segmenter.feed('\x1b[?1049l');
    expect(altCb).toHaveBeenCalledWith(false);
  });

  it('pauses segmentation during alt-screen', () => {
    const segmenter = new BlockSegmenter();
    const blockCb = vi.fn();
    segmenter.onBlock(blockCb);

    segmenter.feed('user@host:~$ ');
    segmenter.feed('\x1b[?1049hsome vim stuff\n');
    segmenter.feed('\x1b[?1049l');
    segmenter.feed('user@host:~$ ');

    expect(blockCb).toHaveBeenCalledTimes(0);
  });

  it('detects remote sessions via prompt identity change', () => {
    const segmenter = new BlockSegmenter();
    const promptCb = vi.fn();
    segmenter.onPromptChange(promptCb);

    segmenter.feed('local@machine:~$ ');
    segmenter.feed('ssh remote\nsome output\n');
    segmenter.feed('remote@server:~$ ');

    const lastCall = promptCb.mock.calls[promptCb.mock.calls.length - 1];
    expect(lastCall[1]).toBe(true); // isRemote
  });

  it('resets all state', () => {
    const segmenter = new BlockSegmenter();
    segmenter.feed('user@host:~$ ');
    expect(segmenter.seenFirstPrompt).toBe(true);
    segmenter.reset();
    expect(segmenter.seenFirstPrompt).toBe(false);
  });
});
