import { describe, it, expect } from 'vitest';
import { BlockSegmenter } from '@/components/BlockSegmenter';
import type { ModeSignal } from '@/utils/terminalMode';

function osc133(letter: string) {
  return `\x1b]133;${letter}\x07`;
}

function collect(): { signals: ModeSignal[]; seg: BlockSegmenter } {
  const seg = new BlockSegmenter();
  const signals: ModeSignal[] = [];
  seg.onModeSignal(s => signals.push(s));
  return { signals, seg };
}

describe('BlockSegmenter mode signals', () => {
  it('emits an altScreen signal on entry and exit', () => {
    const { seg, signals } = collect();
    seg.feed(osc133('A'));
    seg.feed('$ ');
    seg.feed(osc133('B'));
    seg.feed('htop\n');
    seg.feed(osc133('C'));
    seg.feed('\x1b[?1049h');
    seg.feed('\x1b[?1049l');

    expect(signals).toContainEqual({ kind: 'altScreen', entered: true });
    expect(signals).toContainEqual({ kind: 'altScreen', entered: false });
  });

  it('emits a tuiHint for a cursor-reposition redraw, not an altScreen signal', () => {
    const { seg, signals } = collect();
    seg.feed(osc133('A'));
    seg.feed('$ ');
    seg.feed(osc133('B'));
    seg.feed('claude\n');
    seg.feed(osc133('C'));
    seg.feed('\x1b[2A');

    expect(signals).toContainEqual({ kind: 'tuiHint' });
    expect(signals).not.toContainEqual({ kind: 'altScreen', entered: true });
  });

  it('emits osc133 phase signals', () => {
    const { seg, signals } = collect();
    seg.feed(osc133('A'));
    seg.feed('$ ');
    seg.feed(osc133('B'));
    seg.feed('ls\n');
    seg.feed(osc133('C'));

    const phases = signals.filter(s => s.kind === 'osc133').map(s => (s as { phase: string }).phase);
    expect(phases).toEqual(['prompt', 'command', 'output']);
  });

  it('emits hook signals for preexec and precmd', async () => {
    const { encodeOsc6973 } = await import('@/utils/osc6973');
    const { seg, signals } = collect();
    seg.feed(osc133('A'));
    seg.feed('$ ');
    seg.feed(osc133('B'));
    seg.feed(encodeOsc6973({ hook: 'preexec', command: 'ls' }));
    seg.feed(osc133('C'));
    seg.feed(osc133('D;0'));
    seg.feed(encodeOsc6973({
      hook: 'precmd', exit: 0, signal: null, duration_ms: 1, command: 'ls', cwd: '/',
    }));

    const hooks = signals.filter(s => s.kind === 'hook').map(s => (s as any).hook.hook);
    expect(hooks).toEqual(['preexec', 'precmd']);
  });

  it('still fires the legacy altScreen and interactive callbacks', () => {
    // This task is additive; Task 8 removes these. Their survival here is what
    // makes the refactor reviewable as behaviour-neutral.
    const seg = new BlockSegmenter();
    const alt: boolean[] = [];
    seg.onAltScreen(e => alt.push(e));

    seg.feed(osc133('A'));
    seg.feed('$ ');
    seg.feed(osc133('B'));
    seg.feed('htop\n');
    seg.feed(osc133('C'));
    seg.feed('\x1b[?1049h');

    expect(alt).toEqual([true]);
  });
});
