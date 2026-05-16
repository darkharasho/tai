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

  it('handles carriage returns in partial lines', () => {
    const segmenter = new BlockSegmenter();
    const blockCb = vi.fn();
    segmenter.onBlock(blockCb);

    segmenter.feed('user@host:~$ ');
    segmenter.feed('ls\nfile1\nfile2\n');
    // Simulate CR before prompt (common in SSH sessions)
    segmenter.feed('extra\ruser@host:~$ ');

    expect(blockCb).toHaveBeenCalledTimes(1);
    const block = blockCb.mock.calls[0][0];
    expect(block.command).toBe('ls');
    expect(block.promptText).toBe('user@host:~$ ');
  });

  it('detects remote when already SSHed at session start via local hostname', () => {
    const segmenter = new BlockSegmenter();
    segmenter.setLocalHostname('bazziie');
    const promptCb = vi.fn();
    const blockCb = vi.fn();
    segmenter.onPromptChange(promptCb);
    segmenter.onBlock(blockCb);

    segmenter.feed('user@piclock:~$ ');
    expect(promptCb).toHaveBeenCalledWith('user@piclock:~$ ', true, 'user@piclock');

    segmenter.feed('hostname\npiclock\n');
    segmenter.feed('user@piclock:~$ ');
    expect(blockCb).toHaveBeenCalledTimes(1);
    expect(blockCb.mock.calls[0][0].isRemote).toBe(true);
  });

  it('cleans junk from prompt when bare CR precedes it', () => {
    const segmenter = new BlockSegmenter();
    const promptCb = vi.fn();
    segmenter.onPromptChange(promptCb);

    segmenter.feed('user@host:~$ ');
    segmenter.feed('hostname\noutput\n');
    segmenter.feed('junk\ruser@host:~$ ');

    const lastCall = promptCb.mock.calls[promptCb.mock.calls.length - 1];
    expect(lastCall[0]).toBe('user@host:~$ ');
  });

  it('does not flag local prompt as remote when hostname matches', () => {
    const segmenter = new BlockSegmenter();
    segmenter.setLocalHostname('machine');
    const promptCb = vi.fn();
    segmenter.onPromptChange(promptCb);

    segmenter.feed('local@machine:~$ ');
    expect(promptCb).toHaveBeenCalledWith('local@machine:~$ ', false, null);
  });

  it('resets all state', () => {
    const segmenter = new BlockSegmenter();
    segmenter.feed('user@host:~$ ');
    expect(segmenter.seenFirstPrompt).toBe(true);
    segmenter.reset();
    expect(segmenter.seenFirstPrompt).toBe(false);
  });

  describe('OSC 133 shell integration', () => {
    const A = '\x1b]133;A\x07';
    const B = '\x1b]133;B\x07';
    const C = '\x1b]133;C\x07';
    const D = (ec: number) => `\x1b]133;D;${ec}\x07`;

    it('activates integration mode on first marker and notifies', () => {
      const segmenter = new BlockSegmenter();
      const intCb = vi.fn();
      segmenter.onShellIntegration(intCb);

      segmenter.feed(`${A}user@host:~$ ${B}`);
      expect(segmenter.shellIntegrationActive).toBe(true);
      expect(intCb).toHaveBeenCalledWith(true);
    });

    it('segments a command using A/B/C/D markers, capturing exit code', () => {
      const segmenter = new BlockSegmenter();
      const blockCb = vi.fn();
      segmenter.onBlock(blockCb);

      segmenter.feed(`${A}user@host:~$ ${B}ls\n${C}file1.txt\nfile2.txt\n${D(0)}${A}user@host:~$ ${B}`);

      expect(blockCb).toHaveBeenCalledTimes(1);
      const block = blockCb.mock.calls[0][0];
      expect(block.command).toBe('ls');
      expect(block.output).toContain('file1.txt');
      expect(block.exitCode).toBe(0);
    });

    it('strips OSC 133 markers from downstream-visible output', () => {
      const segmenter = new BlockSegmenter();
      const outputCb = vi.fn();
      segmenter.onOutput(outputCb);

      segmenter.feed(`${A}user@host:~$ ${B}echo hi\n${C}hi\n`);
      const seen = outputCb.mock.calls.map(c => c[0]).join('');
      expect(seen).not.toContain('\x1b]133');
    });

    it('captures non-zero exit codes', () => {
      const segmenter = new BlockSegmenter();
      const blockCb = vi.fn();
      segmenter.onBlock(blockCb);

      segmenter.feed(`${A}$ ${B}false\n${C}${D(1)}${A}$ ${B}`);
      expect(blockCb.mock.calls[0][0].exitCode).toBe(1);
    });

    it('fires onPromptChange with stripped prompt text on B', () => {
      const segmenter = new BlockSegmenter();
      const promptCb = vi.fn();
      segmenter.onPromptChange(promptCb);

      segmenter.feed(`${A}user@host:~$ ${B}`);
      expect(promptCb).toHaveBeenCalled();
      const lastCall = promptCb.mock.calls[promptCb.mock.calls.length - 1];
      expect(lastCall[0]).toBe('user@host:~$ ');
    });

    it('handles markers split across feed() calls', () => {
      const segmenter = new BlockSegmenter();
      const blockCb = vi.fn();
      segmenter.onBlock(blockCb);

      segmenter.feed(`${A}$ `);
      segmenter.feed(`${B}pwd\n`);
      segmenter.feed(`${C}/home\n`);
      segmenter.feed(`${D(0)}`);
      segmenter.feed(`${A}$ ${B}`);

      expect(blockCb).toHaveBeenCalledTimes(1);
      expect(blockCb.mock.calls[0][0].command).toBe('pwd');
      expect(blockCb.mock.calls[0][0].output).toContain('/home');
    });

    it('accepts ST terminator (ESC \\\\) as well as BEL', () => {
      const segmenter = new BlockSegmenter();
      const intCb = vi.fn();
      segmenter.onShellIntegration(intCb);
      segmenter.feed('\x1b]133;A\x1b\\$ \x1b]133;B\x1b\\');
      expect(intCb).toHaveBeenCalledWith(true);
    });

    it('bypasses the regex prompt heuristic once integration is active', () => {
      const segmenter = new BlockSegmenter();
      const blockCb = vi.fn();
      segmenter.onBlock(blockCb);

      // Integrated session — the embedded "$ " text inside output must NOT
      // create a phantom block.
      segmenter.feed(`${A}$ ${B}echo '$ trick'\n${C}$ trick\n${D(0)}${A}$ ${B}`);
      expect(blockCb).toHaveBeenCalledTimes(1);
      expect(blockCb.mock.calls[0][0].command).toBe("echo '$ trick'");
    });
  });
});
