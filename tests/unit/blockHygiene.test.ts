import { describe, it, expect, vi } from 'vitest';
import { BlockSegmenter } from '@/components/BlockSegmenter';
import { isIncompleteCommand, foldPs2Continuations, stripPs2 } from '@/utils/ps2Fold';

describe('isIncompleteCommand', () => {
  it('flags an open heredoc', () => {
    expect(isIncompleteCommand("python3 - <<'EOF'")).toBe(true);
    expect(isIncompleteCommand("python3 - <<'EOF'\nprint(1)\nEOF")).toBe(false);
  });
  it('flags trailing continuation operators', () => {
    expect(isIncompleteCommand('ls |')).toBe(true);
    expect(isIncompleteCommand('ls &&')).toBe(true);
    expect(isIncompleteCommand('ls \\')).toBe(true);
    expect(isIncompleteCommand('ls -la')).toBe(false);
  });
  it('flags open quotes and compound statements', () => {
    expect(isIncompleteCommand('echo "hi')).toBe(true);
    expect(isIncompleteCommand('for i in 1 2 3; do')).toBe(true);
    expect(isIncompleteCommand('for i in 1 2 3; do echo $i; done')).toBe(false);
    expect(isIncompleteCommand('if true; then')).toBe(true);
  });
  it('does not flag words containing keywords', () => {
    expect(isIncompleteCommand('docker ps')).toBe(false);
    expect(isIncompleteCommand('cat undone.txt')).toBe(false);
  });
});

describe('foldPs2Continuations', () => {
  it('folds zsh heredoc continuation echoes into the command', () => {
    const { command, outputLines } = foldPs2Continuations(
      "python3 - <<'EOF'",
      ['heredoc> print(1)', 'heredoc> EOF', 'actual output'],
      ['heredoc> print(1)', 'heredoc> EOF', 'actual output'],
    );
    expect(command).toBe("python3 - <<'EOF'\nprint(1)\nEOF");
    expect(outputLines).toEqual(['actual output']);
  });

  it('folds bash bare `> ` continuations for a loop', () => {
    const { command, outputLines } = foldPs2Continuations(
      'for i in 1 2; do',
      ['> echo $i', '> done', '1', '2'],
      ['> echo $i', '> done', '1', '2'],
    );
    expect(command).toBe('for i in 1 2; do\necho $i\ndone');
    expect(outputLines).toEqual(['1', '2']);
  });

  it('leaves output alone when the command is complete', () => {
    const { command, outputLines } = foldPs2Continuations(
      'grep foo log',
      ['match> foo here'],
      ['match> foo here'],
    );
    expect(command).toBe('grep foo log');
    expect(outputLines).toEqual(['match> foo here']);
  });

  it('strips multi-word zsh PS2 contexts', () => {
    expect(stripPs2('cmdand heredoc> s = StorageManager()')).toBe('s = StorageManager()');
    expect(stripPs2('heredoc>')).toBe('');
  });
});

describe('BlockSegmenter hygiene (screenshot regressions)', () => {
  const PROMPT = 'piclock@piclock ~/axitools ❯ ';

  it('reassembles a pasted heredoc into one clean multi-line command', () => {
    const seg = new BlockSegmenter();
    const blocks: any[] = [];
    seg.onBlock(b => blocks.push(b));

    seg.feed(PROMPT);
    // zsh echoes the first char, backspaces, then redraws the full line —
    // exactly the byte pattern that used to leave "c␈cd …" garbage.
    seg.feed("c\b\x1b[Kcd /path/to/axitools && python3 - <<'EOF'\r\n");
    seg.feed('cmdand heredoc> f\b\x1b[Kfrom collections import Counter\r\n');
    seg.feed('cmdand heredoc> print(Counter())\r\n');
    seg.feed('cmdand heredoc> EOF\r\n');
    seg.feed('cd: no such file or directory: /path/to/axitools\r\n');
    seg.feed(PROMPT);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].command).toBe(
      "cd /path/to/axitools && python3 - <<'EOF'\nfrom collections import Counter\nprint(Counter())\nEOF",
    );
    expect(blocks[0].output).toBe('cd: no such file or directory: /path/to/axitools');
    expect(blocks[0].output).not.toContain('\b');
    expect(blocks[0].output).not.toContain('heredoc>');
  });

  it('does not emit a noise block for a redrawn/empty prompt', () => {
    const seg = new BlockSegmenter();
    const blocks: any[] = [];
    seg.onBlock(b => blocks.push(b));

    seg.feed(PROMPT);
    // Bare Enter: newline, then the prompt redraws (with an erase-line).
    seg.feed('\r\n');
    seg.feed(`\x1b[K${PROMPT}`);
    // Another bare Enter with a thrice-redrawn prompt (RPROMPT refresh).
    seg.feed('\r\n');
    seg.feed(`${PROMPT}\r\x1b[K${PROMPT}\r\x1b[K${PROMPT}`);

    expect(blocks).toHaveLength(0);
  });

  it('collapses prompt redraws so the command line is not tripled', () => {
    const seg = new BlockSegmenter();
    const blocks: any[] = [];
    seg.onBlock(b => blocks.push(b));

    seg.feed(PROMPT);
    seg.feed(`\r\x1b[K${PROMPT}\r\x1b[K${PROMPT}ls\r\n`);
    seg.feed('file.txt\r\n');
    seg.feed(PROMPT);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].command).toBe('ls');
    expect(blocks[0].output).toBe('file.txt');
  });

  it('keeps output free of raw control bytes', () => {
    const seg = new BlockSegmenter();
    const out = vi.fn();
    seg.onOutput(out);

    seg.feed('user@host:~$ ');
    seg.feed('cmd\n');
    seg.feed('ding\x07 and dragged\x08\x08\x08\x08\x1b[Kshown\n');
    const last = out.mock.calls.at(-1)![0];
    expect(last).not.toMatch(/[\x00-\x08\x0b\x0c\x0e-\x1f]/);
    expect(last).toContain('ding and drashown');
  });

  it('clears the ssh session when the remote shell dies without a D marker', () => {
    // Remote `exit`: the remote shell dies before emitting OSC 133 D, so its
    // C marker leaves _cmdDepth inflated. ssh's "Connection closed" sentinel
    // plus the next local prompt must still clear the session — otherwise the
    // composer pill stays stuck on the dead remote host.
    const A = '\x1b]133;A\x07', B = '\x1b]133;B\x07', C = '\x1b]133;C\x07';
    const D = (ec: number) => `\x1b]133;D;${ec}\x07`;
    const seg = new BlockSegmenter();
    const sshCb = vi.fn();
    seg.onSshSession(sshCb);

    const blocks: any[] = [];
    seg.onBlock(b => blocks.push(b));

    seg.feed(`${A}local@box:~$ ${B}ssh user@piclock.local\n${C}`);
    expect(seg.sshSessionActive).toBe(true);

    // Remote (integrated) prompt, then `exit`: C arrives, D never does.
    seg.feed(`${A}user@piclock:~$ ${B}exit\n${C}logout\n`);
    // ssh teardown output + the local ssh command's own D, then local prompt.
    seg.feed('Connection to piclock.local closed.\r\n');
    seg.feed(`${D(127)}${A}local@box:~$ ${B}`);

    expect(seg.sshSessionActive).toBe(false);
    expect(sshCb).toHaveBeenLastCalledWith(false, null);
    // The 127 belongs to the dying connection, not the user's `exit` — the
    // finalized block must not carry it as a failure.
    const exitBlock = blocks.find(b => b.command === 'exit');
    expect(exitBlock).toBeTruthy();
    expect(exitBlock.exitCode).toBeUndefined();
  });

  it('folds PS2 echoes inside an OSC 133 integrated command', () => {
    const A = '\x1b]133;A\x07', B = '\x1b]133;B\x07', C = '\x1b]133;C\x07';
    const D = (ec: number) => `\x1b]133;D;${ec}\x07`;
    const seg = new BlockSegmenter();
    const blocks: any[] = [];
    seg.onBlock(b => blocks.push(b));

    seg.feed(`${A}user@host:~$ ${B}for i in 1 2; do\nheredoc> echo $i\nheredoc> done\n${C}1\n2\n${D(0)}${A}user@host:~$ ${B}`);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].command).toBe('for i in 1 2; do\necho $i\ndone');
    expect(blocks[0].output).toBe('1\n2');
  });

  it('suppresses the bash bootstrap-echo line but segments the next real command', () => {
    // Simulate what the TTY produces when TAI types ` . '/tmp/x/tai-bash.sh'`
    // into a fresh bash tab. The echo arrives before the first OSC 133 A (the
    // shell integration hasn't loaded yet), so it hits the legacy path.
    const PROMPT = 'user@host:~$ ';
    const seg = new BlockSegmenter();
    const blocks: any[] = [];
    seg.onBlock(b => blocks.push(b));

    // First prompt — sets up the initial prompt state.
    seg.feed(PROMPT);
    // The bootstrap line is echoed by the TTY before integration loads.
    seg.feed(" . '/tmp/x/tai-bash.sh'\r\n");
    // The shell sources the integration and re-emits the prompt.
    seg.feed(PROMPT);
    // Now the user runs a real command.
    seg.feed('echo hello\r\n');
    seg.feed('hello\r\n');
    seg.feed(PROMPT);

    // No block must be emitted for the bootstrap echo.
    expect(blocks).toHaveLength(1);
    expect(blocks[0].command).toBe('echo hello');
    expect(blocks[0].output).toBe('hello');
  });

  it('suppresses the bootstrap echo in the integrated OSC 133 path', () => {
    const A = '\x1b]133;A\x07', B = '\x1b]133;B\x07', C = '\x1b]133;C\x07';
    const D = (ec: number) => `\x1b]133;D;${ec}\x07`;
    const seg = new BlockSegmenter();
    const blocks: any[] = [];
    seg.onBlock(b => blocks.push(b));

    // Bootstrap echo arrives as the "command" in a block (defense-in-depth).
    seg.feed(`${A}user@host:~$ ${B}. '/tmp/x/tai-bash.sh'\n${C}${D(0)}`);
    // A real command follows normally.
    seg.feed(`${A}user@host:~$ ${B}echo hi\n${C}hi\n${D(0)}${A}user@host:~$ ${B}`);

    // Bootstrap block must be dropped; only the real command block is emitted.
    expect(blocks).toHaveLength(1);
    expect(blocks[0].command).toBe('echo hi');
    expect(blocks[0].output).toBe('hi');
  });
});
