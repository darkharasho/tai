import { describe, it, expect } from 'vitest';
import { BlockSegmenter } from '@/components/BlockSegmenter';
import { encodeOsc6973 } from '@/utils/osc6973';

function osc133(letter: string) {
  return `\x1b]133;${letter}\x07`;
}

describe('BlockSegmenter OSC 6973 enrichment', () => {
  it('attaches signal/cwd/commandFromShell from precmd hook', () => {
    const seg = new BlockSegmenter();
    const blocks: any[] = [];
    seg.onBlock(b => blocks.push(b));

    seg.feed(osc133('A'));
    seg.feed('mike@host:~$ ');
    seg.feed(osc133('B'));
    seg.feed(encodeOsc6973({ hook: 'preexec', command: 'git status' }));
    seg.feed('git status\n');
    seg.feed(osc133('C'));
    seg.feed('On branch master\n');
    seg.feed(osc133('D;0'));
    seg.feed(encodeOsc6973({
      hook: 'precmd',
      exit: 0,
      signal: null,
      duration_ms: 42,
      command: 'git status',
      cwd: '/home/m/code/tai',
    }));
    seg.feed(osc133('A'));
    seg.feed('mike@host:~$ ');
    seg.feed(osc133('B'));

    expect(blocks).toHaveLength(1);
    expect(blocks[0].commandFromShell).toBe('git status');
    expect(blocks[0].cwd).toBe('/home/m/code/tai');
    expect(blocks[0].signal).toBeNull();
    expect(blocks[0].hooksAvailable).toBe(true);
    expect(blocks[0].exitCode).toBe(0);
  });

  it('still segments when OSC 6973 is absent (hooksAvailable=false)', () => {
    const seg = new BlockSegmenter();
    const blocks: any[] = [];
    seg.onBlock(b => blocks.push(b));

    seg.feed(osc133('A') + '$ ' + osc133('B') + 'ls\n' + osc133('C') + 'a b c\n' + osc133('D;0') + osc133('A') + '$ ' + osc133('B'));
    expect(blocks).toHaveLength(1);
    expect(blocks[0].hooksAvailable).toBe(false);
  });

  it('fires onBlockActive(true) on OSC 133 C and onBlockActive(false) on D', () => {
    const seg = new BlockSegmenter();
    const events: boolean[] = [];
    seg.onBlockActive(a => events.push(a));
    seg.feed('\x1b]133;A\x07$ \x1b]133;B\x07cmd\n\x1b]133;C\x07output\n\x1b]133;D;0\x07');
    expect(events).toEqual([true, false]);
  });

  it('detects alt-screen enter even when the escape spans chunk boundaries', () => {
    const seg = new BlockSegmenter();
    const events: boolean[] = [];
    seg.onModeSignal(s => { if (s.kind === 'altScreen') events.push(s.entered); });
    seg.feed('\x1b]133;A\x07$ \x1b]133;B\x07cmd\n\x1b]133;C\x07');
    seg.feed('banner\x1b[?');   // chunk ends mid-sequence
    expect(events).toEqual([]); // not yet detected
    seg.feed('1049h');           // tail continues the sequence
    expect(events).toEqual([true]);
  });

  it('ignores malformed OSC 6973 payloads', () => {
    const seg = new BlockSegmenter();
    const blocks: any[] = [];
    seg.onBlock(b => blocks.push(b));

    seg.feed(osc133('A') + '$ ' + osc133('B'));
    seg.feed('\x1b]6973;zzznotvalidhex\x07');
    seg.feed(osc133('C') + 'output\n' + osc133('D;1') + osc133('A') + '$ ' + osc133('B'));
    expect(blocks).toHaveLength(1);
    expect(blocks[0].exitCode).toBe(1);
    expect(blocks[0].hooksAvailable).toBe(false);
  });
});

describe('BlockSegmenter command from hooks', () => {
  it('prefers the preexec command over reconstructed echo', () => {
    const seg = new BlockSegmenter();
    const blocks: any[] = [];
    seg.onBlock(b => blocks.push(b));

    seg.feed(osc133('A'));
    seg.feed('mike@host:~$ ');
    seg.feed(osc133('B'));
    seg.feed(encodeOsc6973({ hook: 'preexec', command: 'git status' }));
    // The echoed bytes are mangled by an autosuggestion ghost the shell then
    // erased — exactly the shape renderTermText has to guess its way through.
    seg.feed('git status --short\x1b[8D\x1b[K');
    seg.feed(osc133('C'));
    seg.feed('On branch master\n');
    seg.feed(osc133('D;0'));
    seg.feed(osc133('A'));
    seg.feed('mike@host:~$ ');
    seg.feed(osc133('B'));

    expect(blocks).toHaveLength(1);
    expect(blocks[0].command).toBe('git status');
    expect(blocks[0].commandFromShell).toBe('git status');
    expect(blocks[0].hooksAvailable).toBe(true);
  });

  it('does not source command from precmd alone — precmd can leak across a nesting boundary', () => {
    // precmd fires at command END, so under shell nesting it can belong to a
    // different (often outer) shell than the block it reaches. preexec fires
    // at command START from the shell that owns the block and cannot leak
    // this way, so it is the only hook used as a command source; precmd is
    // corroboration/metadata (commandFromShell, cwd, signal) only.
    const seg = new BlockSegmenter();
    const blocks: any[] = [];
    seg.onBlock(b => blocks.push(b));

    seg.feed(osc133('A'));
    seg.feed('$ ');
    seg.feed(osc133('B'));
    seg.feed('garbled\x1b[7D');
    seg.feed(osc133('C'));
    seg.feed('out\n');
    seg.feed(osc133('D;0'));
    seg.feed(encodeOsc6973({
      hook: 'precmd', exit: 0, signal: null, duration_ms: 5,
      command: 'ls -la', cwd: '/tmp',
    }));
    seg.feed(osc133('A'));
    seg.feed('$ ');
    seg.feed(osc133('B'));

    expect(blocks[0].command).toBe('garbled');
    expect(blocks[0].commandFromShell).toBe('ls -la');
    expect(blocks[0].hooksAvailable).toBe(true);
  });

  it('falls back to echo reconstruction when no hooks arrive', () => {
    const seg = new BlockSegmenter();
    const blocks: any[] = [];
    seg.onBlock(b => blocks.push(b));

    seg.feed(osc133('A'));
    seg.feed('$ ');
    seg.feed(osc133('B'));
    seg.feed('echo hi');
    seg.feed(osc133('C'));
    seg.feed('hi\n');
    seg.feed(osc133('D;0'));
    seg.feed(osc133('A'));
    seg.feed('$ ');
    seg.feed(osc133('B'));

    expect(blocks[0].command).toBe('echo hi');
    expect(blocks[0].hooksAvailable).toBe(false);
  });

  it('strips PS2 prefixes from continuation lines in the echo-reconstruction fallback', () => {
    // No preexec/precmd at all — this is now the ONLY path for a
    // non-integrated shell, and its multi-line branch (stripPs2 applied to
    // every line after the first) needs direct coverage.
    const seg = new BlockSegmenter();
    const blocks: any[] = [];
    seg.onBlock(b => blocks.push(b));

    seg.feed(osc133('A'));
    seg.feed('$ ');
    seg.feed(osc133('B'));
    seg.feed('for i in 1 2\n> do echo $i\n> done');
    seg.feed(osc133('C'));
    seg.feed('1\n2\n');
    seg.feed(osc133('D;0'));
    seg.feed(osc133('A'));
    seg.feed('$ ');
    seg.feed(osc133('B'));

    expect(blocks[0].command).toBe('for i in 1 2\ndo echo $i\ndone');
    expect(blocks[0].hooksAvailable).toBe(false);
  });

  it('parses the SSH target from the hook command, not the mangled echo', () => {
    const seg = new BlockSegmenter();
    const sshEvents: Array<[boolean, string | null]> = [];
    seg.onSshSession((active, target) => sshEvents.push([active, target]));

    seg.feed(osc133('A'));
    seg.feed('$ ');
    seg.feed(osc133('B'));
    seg.feed(encodeOsc6973({ hook: 'preexec', command: 'ssh build-01' }));
    // Echo wrapped across a line boundary the way a narrow terminal does it.
    seg.feed('ssh bui\r\nld-01');
    seg.feed(osc133('C'));

    expect(sshEvents).toContainEqual([true, 'build-01']);
  });
});
