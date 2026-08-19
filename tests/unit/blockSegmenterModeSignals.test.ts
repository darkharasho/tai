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

  it('ends the revocable takeover before a real alt screen supersedes it', () => {
    // Cursor hide, then a genuine [?1049h. The resolver alone would not need
    // the exit — an observed alt screen upgrades the claim in place — but the
    // exit carries component-side side effects (TerminalSession harvests the
    // hidden xterm's buffer and clears passwordPrompt on it). Neither the
    // pre-migration code nor the first cut of this task tested it: the legacy
    // callback fired here and its replacement silently did not, so a password
    // prompt followed by a TUI kept `passwordPrompt` stuck true.
    const { seg, signals } = collect();
    seg.feed('user@host:~$ ');
    seg.feed('\x1b[?25l');
    seg.feed('\x1b[?1049h');

    const tail = signals.map(s => (
      s.kind === 'fullscreenHint' ? `fullscreenHint:${s.entered}`
        : s.kind === 'altScreen' ? `altScreen:${s.entered}`
        : s.kind
    ));
    expect(tail).toEqual(['fullscreenHint:true', 'fullscreenHint:false', 'altScreen:true']);
  });

  it('emits an altScreen exit when a new prompt clears the alt-screen latch', () => {
    // The A handler drops the latch without an exit sequence ever arriving.
    // The resolver has to hear that directly rather than by way of the prompt
    // signal that follows it — there is no legacy callback left to carry it.
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

  it('signals the legacy cursor-hide takeover as a REVOCABLE fullscreen', () => {
    // Non-integrated shell: _feedLegacy reads a cursor hide as a fullscreen
    // takeover, but a revocable one — a cursor hide is how a full TUI and a
    // cooked spinner both begin. `altScreen` would make it survive a cooked
    // termios reading (resolver rule 3) and strand the spinner off the
    // composer, so it gets `fullscreenHint` instead.
    const { seg, signals } = collect();
    seg.feed('user@host:~$ ');
    seg.feed('\x1b[?25l');
    expect(signals).toContainEqual({ kind: 'fullscreenHint', entered: true });
    expect(signals).not.toContainEqual({ kind: 'altScreen', entered: true });
    seg.feed('\x1b[?25h');
    expect(signals).toContainEqual({ kind: 'fullscreenHint', entered: false });
  });
});
