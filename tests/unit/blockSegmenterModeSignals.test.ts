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

  it('does not emit an output phase for a stray Ptyxis C in the prompt area', () => {
    // Ptyxis/GNOME Terminal's bash integration emits a non-spec C inside the
    // prompt area. The emit must sit after that guard, or the resolver is told
    // a command is running while the user is still at the prompt.
    const { seg, signals } = collect();
    seg.feed(osc133('A'));
    seg.feed('$ ');
    seg.feed(osc133('C'));

    const phases = signals.filter(s => s.kind === 'osc133').map(s => (s as { phase: string }).phase);
    expect(phases).toEqual(['prompt']);
  });

  it('emits an altScreen exit when a new prompt clears the alt-screen latch', () => {
    // The A handler drops the latch without an exit sequence ever arriving.
    // Task 8 deletes onAltScreen, so the resolver must hear this directly
    // rather than by way of the prompt signal that follows it.
    const { seg, signals } = collect();
    seg.feed(osc133('A'));
    seg.feed('$ ');
    seg.feed(osc133('B'));
    seg.feed('vim\n');
    seg.feed(osc133('C'));
    seg.feed('\x1b[?1049h');
    seg.feed(osc133('A'));

    const kinds = signals.map(s => (s.kind === 'altScreen' ? `altScreen:${s.entered}` : s.kind));
    expect(kinds.slice(-2)).toEqual(['altScreen:false', 'osc133']);
  });

  it('leaves the legacy cursor-hide takeover unsignalled on entry and clears it on exit', () => {
    // Non-integrated shell: _feedLegacy reads a cursor hide as a fullscreen
    // takeover, but a REVOCABLE one — a cooked termios reading ends it today.
    // `altScreen` would make it survive that reading (resolver rule 3), which
    // is a different rendered surface for the same bytes, so entry stays
    // unsignalled until Task 8 introduces a signal that can express it. The
    // exit is signalled so the resolver can never be stranded.
    const { seg, signals } = collect();
    seg.feed('user@host:~$ ');
    seg.feed('\x1b[?25l');
    expect(signals).not.toContainEqual({ kind: 'altScreen', entered: true });
    seg.feed('\x1b[?25h');
    expect(signals).toContainEqual({ kind: 'altScreen', entered: false });
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
