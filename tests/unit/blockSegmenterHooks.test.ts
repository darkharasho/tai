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
