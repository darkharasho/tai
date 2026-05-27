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

  it('streams onOutput per output line in legacy (non-integrated) mode', () => {
    const segmenter = new BlockSegmenter();
    const outputCb = vi.fn();
    segmenter.onOutput(outputCb);

    // Prompt detection + command echo. Legacy mode emits per newline once
    // _seenFirstPrompt is set, so this models the live-streaming pending card.
    segmenter.feed('user@host:~$ ');
    segmenter.feed('cmd\n');
    const baseline = outputCb.mock.calls.length;

    segmenter.feed('1\n');
    expect(outputCb.mock.calls.length).toBeGreaterThan(baseline);
    expect(outputCb.mock.calls.at(-1)![0]).toContain('1');

    const afterOne = outputCb.mock.calls.length;
    segmenter.feed('2\n');
    expect(outputCb.mock.calls.length).toBeGreaterThan(afterOne);
    expect(outputCb.mock.calls.at(-1)![0]).toContain('2');
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

    it('streams onOutput per chunk during a long-running command (OSC 133)', () => {
      const segmenter = new BlockSegmenter();
      const outputCb = vi.fn();
      segmenter.onOutput(outputCb);

      // Prompt + command typed + preexec marker (start of output phase).
      segmenter.feed(`${A}user@host:~$ ${B}sleep-loop\n${C}`);

      const callsAfterStart = outputCb.mock.calls.length;
      expect(callsAfterStart).toBe(0);

      // Output trickles in chunk-by-chunk, as it would from a real PTY for
      // `for i in 1 2 3; do echo $i; sleep 1; done`.
      segmenter.feed('1\n');
      expect(outputCb.mock.calls.length).toBeGreaterThan(callsAfterStart);
      expect(outputCb.mock.calls.at(-1)![0]).toContain('1');

      const afterOne = outputCb.mock.calls.length;
      segmenter.feed('2\n');
      expect(outputCb.mock.calls.length).toBeGreaterThan(afterOne);
      expect(outputCb.mock.calls.at(-1)![0]).toContain('2');

      const afterTwo = outputCb.mock.calls.length;
      segmenter.feed('3\n');
      expect(outputCb.mock.calls.length).toBeGreaterThan(afterTwo);
      expect(outputCb.mock.calls.at(-1)![0]).toContain('3');
    });

    it('streams onOutput byte-by-byte (worst-case PTY chunking)', () => {
      const segmenter = new BlockSegmenter();
      const outputCb = vi.fn();
      segmenter.onOutput(outputCb);

      segmenter.feed(`${A}$ ${B}cmd\n${C}`);
      const baseline = outputCb.mock.calls.length;

      const payload = 'hello world\n';
      for (const ch of payload) segmenter.feed(ch);

      // Each byte after entering output phase should produce an emit — the
      // pending command card depends on this for live streaming.
      expect(outputCb.mock.calls.length).toBe(baseline + payload.length);
      expect(outputCb.mock.calls.at(-1)![0]).toContain('hello world');
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

    it('ignores a stray C marker emitted inside the prompt area', () => {
      // Ptyxis/GNOME Terminal's bash integration emits A → (stray C) → B
      // during prompt rendering. The C should not flip phase to "output", or
      // the visible prompt characters end up in the command output buffer.
      const segmenter = new BlockSegmenter();
      const blockCb = vi.fn();
      segmenter.onBlock(blockCb);

      segmenter.feed(`${A}${C}user@host:~$ ${B}whoami\nmstephens\n${D(0)}${A}`);
      expect(blockCb).toHaveBeenCalledTimes(1);
      const block = blockCb.mock.calls[0][0];
      expect(block.command).toBe('whoami');
      expect(block.output).toBe('mstephens');
      expect(block.promptText).toBe('user@host:~$ ');
    });

    it('splits command buffer at first newline when no C marker arrives', () => {
      // Same Ptyxis-style integration emits no C between typed-input echo and
      // command output (it uses OSC 3008 for that boundary, which we don't
      // parse). The first newline in the command buffer is the boundary.
      const segmenter = new BlockSegmenter();
      const blockCb = vi.fn();
      segmenter.onBlock(blockCb);

      segmenter.feed(`${A}user@host:~$ ${B}pwd\n/home/user\n${D(0)}${A}`);
      expect(blockCb).toHaveBeenCalledTimes(1);
      expect(blockCb.mock.calls[0][0].command).toBe('pwd');
      expect(blockCb.mock.calls[0][0].output).toBe('/home/user');
    });

    it('flags an ssh sub-session as degraded between C and D', () => {
      const segmenter = new BlockSegmenter();
      const sshCb = vi.fn();
      segmenter.onSshSession(sshCb);

      segmenter.feed(`${A}$ ${B}ssh user@host\n${C}`);
      expect(segmenter.sshSessionActive).toBe(true);
      expect(sshCb).toHaveBeenCalledWith(true, 'user@host');

      // Output from remote shell flows in — no markers.
      segmenter.feed('remote prompt> ls\nfile.txt\n');
      expect(segmenter.sshSessionActive).toBe(true);

      // ssh exits, local shell emits D.
      segmenter.feed(D(0));
      expect(segmenter.sshSessionActive).toBe(false);
      expect(sshCb).toHaveBeenLastCalledWith(false, null);
    });

    it('does not flag non-ssh commands as ssh sessions', () => {
      const segmenter = new BlockSegmenter();
      const sshCb = vi.fn();
      segmenter.onSshSession(sshCb);

      segmenter.feed(`${A}$ ${B}ls\n${C}file\n${D(0)}`);
      expect(segmenter.sshSessionActive).toBe(false);
      expect(sshCb).not.toHaveBeenCalled();
    });

    it('handles ANSI escapes split across feed() boundaries in the prompt', () => {
      // Real-world: a colored prompt like \x1b[38;5;78m... can have its CSI
      // sequence split between two writes. Per-chunk stripAnsi would miss the
      // partial escape and leak literal "78m..." into the prompt text.
      const segmenter = new BlockSegmenter();
      const promptCb = vi.fn();
      segmenter.onPromptChange(promptCb);

      segmenter.feed(`${A}\x1b[38;5;`);
      segmenter.feed(`78muser@host:~$ \x1b[0m${B}`);

      const lastCall = promptCb.mock.calls[promptCb.mock.calls.length - 1];
      expect(lastCall[0]).toBe('user@host:~$ ');
      expect(lastCall[0]).not.toContain('78m');
    });

    it('does not accumulate alt-screen TUI noise into the output buffer', () => {
      const segmenter = new BlockSegmenter();
      const blockCb = vi.fn();
      segmenter.onBlock(blockCb);

      segmenter.feed(`${A}$ ${B}vim\n${C}`);
      // Simulate alt-screen on + tons of TUI bytes + alt-screen off.
      segmenter.feed('\x1b[?1049h');
      segmenter.feed('\x1b[H\x1b[2Jlots of redraw bytes\x1b[5;5Hmore\x1b[10;10Hstuff');
      segmenter.feed('\x1b[?1049l');
      // After exit, vim prints nothing, bash emits D then A.
      segmenter.feed(`${D(0)}${A}$ ${B}`);

      expect(blockCb).toHaveBeenCalledTimes(1);
      const block = blockCb.mock.calls[0][0];
      expect(block.command).toBe('vim');
      expect(block.output).toBe('');
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

  describe('onResize', () => {
    it('flushes the partial line buffer as a complete line', () => {
      const seg = new BlockSegmenter();
      // Feed a partial line with no trailing newline.
      seg.feed('partial-without-newline');
      // Sanity: internal state is not directly observable, so we verify
      // behaviorally — after onResize, feeding more text should NOT be
      // appended to the prior partial.
      seg.onResize(80, 24);
      seg.feed('NEXT\n');
      // After flush, the prior partial is its own line; NEXT is its own line.
      // We assert this by feeding a prompt and watching the resulting block.
      const blocks: any[] = [];
      seg.onBlock(b => blocks.push(b));
      // Drive a fake prompt to finalize a block. Use the regex-prompt path
      // (no OSC 133 integration). Format must match PROMPT_RE.
      seg.feed('user@host:~$ ');
      // Now simulate a command + completion to force block emission.
      seg.feed('echo hi\n');
      seg.feed('hi\n');
      seg.feed('user@host:~$ ');
      // The pre-resize partial should appear in the captured block data, on its
      // own line (no concatenation with NEXT).
      // It ends up as the `command` field of the first block because the
      // segmenter treats it as the first line after the first prompt.
      const allText = blocks.map(b => [b.command ?? '', b.output ?? ''].join('\n')).join('\n');
      expect(allText).toContain('partial-without-newline');
      // And the partial must not be glued to NEXT.
      expect(allText).not.toContain('partial-without-newlineNEXT');
    });

    it('is a no-op when there is no partial buffered', () => {
      const seg = new BlockSegmenter();
      expect(() => seg.onResize(100, 30)).not.toThrow();
    });
  });
});
