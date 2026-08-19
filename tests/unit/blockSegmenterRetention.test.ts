/**
 * Provenance-gated retention.
 *
 * `_routeChunk` used to discard every chunk while `_inAltScreen` was set, and
 * the cursor-reposition regex sets that flag on a guess — so a false inference
 * destroyed output irrecoverably. Mode decides rendering, never retention: a
 * wrong flip should cost an ugly card, never lost data.
 *
 * The feeds below include the escape that actually trips the latch
 * (`TUI_REPOSITION_RE` for the guess, `[?1049h` for the real thing). Without it
 * nothing is drop-eligible, `_routeChunk` takes its ordinary path, and every
 * assertion here would pass against an empty implementation.
 */
import { describe, it, expect } from 'vitest';
import { BlockSegmenter, MAX_RETAINED_BYTES } from '@/components/BlockSegmenter';
import type { ModeState } from '@/utils/terminalMode';

function osc133(letter: string) {
  return `\x1b]133;${letter}\x07`;
}

/** Cursor-up redraw: what an Ink TUI and a cooked progress bar both look like. */
const TUI_REDRAW = '\x1b[2A';
const ALT_SCREEN_ENTER = '\x1b[?1049h';

const INFERRED: ModeState = {
  inputOwner: 'program', provenance: 'inferred',
  passwordPrompt: false, commandRunning: true,
};
const AUTHORITATIVE_FULLSCREEN: ModeState = {
  inputOwner: 'fullscreen', provenance: 'authoritative',
  passwordPrompt: false, commandRunning: true,
};
const AUTHORITATIVE_SHELL: ModeState = {
  inputOwner: 'shell', provenance: 'authoritative',
  passwordPrompt: false, commandRunning: true,
};

/** Drive a block up to its output phase. */
function startBlock(seg: BlockSegmenter, command: string) {
  seg.feed(osc133('A'));
  seg.feed('$ ');
  seg.feed(osc133('B'));
  seg.feed(`${command}\n`);
  seg.feed(osc133('C'));
}

function finishBlock(seg: BlockSegmenter) {
  seg.feed(osc133('D;0'));
  seg.feed(osc133('A'));
  seg.feed('$ ');
  seg.feed(osc133('B'));
}

describe('provenance-gated retention', () => {
  it('recovers output when an authoritative signal contradicts an inferred flip', () => {
    const seg = new BlockSegmenter();
    const blocks: any[] = [];
    seg.onBlock(b => blocks.push(b));

    startBlock(seg, 'brew install foo');
    seg.setModeState(INFERRED);          // false TUI guess from a progress bar
    seg.feed(TUI_REDRAW);
    seg.feed('==> Downloading foo\n');
    seg.feed('==> Installing foo\n');
    seg.setModeState(AUTHORITATIVE_SHELL); // termios: it was cooked all along
    finishBlock(seg);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].output).toContain('Downloading foo');
    expect(blocks[0].output).toContain('Installing foo');
  });

  it('streams the recovered output to the live card, not just the finished block', () => {
    // The card is rendered from the streaming callback; a recovery that only
    // reached the finalized block would leave the running command looking
    // truncated until it exited.
    const seg = new BlockSegmenter();
    const streamed: string[] = [];
    seg.onOutput(text => streamed.push(text));

    startBlock(seg, 'brew install foo');
    seg.setModeState(INFERRED);
    seg.feed(TUI_REDRAW);
    seg.feed('==> Downloading foo\n');
    expect(streamed.join('')).not.toContain('Downloading foo');

    seg.setModeState(AUTHORITATIVE_SHELL);
    expect(streamed.join('')).toContain('Downloading foo');
  });

  it('drops output under an authoritative fullscreen signal, as today', () => {
    const seg = new BlockSegmenter();
    const blocks: any[] = [];
    seg.onBlock(b => blocks.push(b));

    startBlock(seg, 'htop');
    seg.setModeState(AUTHORITATIVE_FULLSCREEN);
    seg.feed(ALT_SCREEN_ENTER);
    seg.feed('full-screen redraw noise that belongs to xterm\n');
    seg.setModeState(AUTHORITATIVE_SHELL);
    finishBlock(seg);

    // Authoritative alt-screen: dropping is correct and stays.
    expect(blocks[0]?.output ?? '').not.toContain('redraw noise');
  });

  it('discards the side buffer when an authoritative signal confirms the guess', () => {
    const seg = new BlockSegmenter();
    const blocks: any[] = [];
    seg.onBlock(b => blocks.push(b));

    startBlock(seg, 'claude');
    seg.setModeState(INFERRED);
    seg.feed(TUI_REDRAW);
    seg.feed('TUI frame redraw\n');
    seg.setModeState({ ...INFERRED, provenance: 'authoritative' }); // confirmed program
    finishBlock(seg);

    // Confirmed: the retained frames are not replayed back into the block.
    expect(blocks[0]?.output ?? '').not.toContain('TUI frame redraw');
  });

  it('retains under degraded provenance, since nothing is safe to drop', () => {
    const seg = new BlockSegmenter();
    const blocks: any[] = [];
    seg.onBlock(b => blocks.push(b));

    startBlock(seg, 'something');
    seg.setModeState({
      inputOwner: 'program', provenance: 'degraded', degradedReason: 'no-termios',
      passwordPrompt: false, commandRunning: true,
    });
    seg.feed(TUI_REDRAW);
    seg.feed('output nobody can vouch for\n');
    seg.setModeState(AUTHORITATIVE_SHELL);
    finishBlock(seg);

    expect(blocks[0].output).toContain('output nobody can vouch for');
  });

  it('replays a guess the block outlives, since nothing ever vouched for it', () => {
    // No authoritative signal ever arrives — the common case for a TUI that is
    // still foreground when its block ends. An unresolved guess falls on the
    // retaining side: the cost of being wrong is an ugly card one way and
    // silently lost output the other.
    const seg = new BlockSegmenter();
    const blocks: any[] = [];
    seg.onBlock(b => blocks.push(b));

    startBlock(seg, 'brew install foo');
    seg.setModeState(INFERRED);
    seg.feed(TUI_REDRAW);
    seg.feed('==> Downloading foo\n');
    finishBlock(seg);

    expect(blocks[0].output).toContain('Downloading foo');
  });

  it('does not leak a retained guess into the next block', () => {
    const seg = new BlockSegmenter();
    const blocks: any[] = [];
    seg.onBlock(b => blocks.push(b));

    startBlock(seg, 'brew install foo');
    seg.setModeState(INFERRED);
    seg.feed(TUI_REDRAW);
    seg.feed('==> Downloading foo\n');
    finishBlock(seg);
    seg.feed('second command\n');
    seg.feed(osc133('C'));
    seg.feed('plain output\n');
    finishBlock(seg);

    expect(blocks).toHaveLength(2);
    expect(blocks[1].output).not.toContain('Downloading foo');
  });

  it('clears a guess at the prompt marker, even when no block was finalized', () => {
    // The prompt-phase path: a latch set between two prompts reaches no
    // finalize (nothing to finalize), so the boundary clear is the only thing
    // stopping those bytes from being replayed into an unrelated later block.
    const seg = new BlockSegmenter();
    const blocks: any[] = [];
    seg.onBlock(b => blocks.push(b));

    seg.feed(osc133('A'));
    seg.feed('$ ');
    seg.setModeState(INFERRED);
    seg.feed(ALT_SCREEN_ENTER);
    seg.feed('stale prompt-phase bytes\n');

    startBlock(seg, 'later command');
    seg.feed('real output\n');
    seg.setModeState(AUTHORITATIVE_SHELL);
    finishBlock(seg);

    expect(blocks[0].output).toContain('real output');
    expect(blocks[0].output).not.toContain('stale prompt-phase bytes');
  });

  it('bounds the side buffer', () => {
    const seg = new BlockSegmenter();
    const blocks: any[] = [];
    seg.onBlock(b => blocks.push(b));

    startBlock(seg, 'noisy');
    seg.setModeState(INFERRED);
    seg.feed(TUI_REDRAW);
    seg.feed('x'.repeat(MAX_RETAINED_BYTES * 2));
    seg.setModeState(AUTHORITATIVE_SHELL);
    finishBlock(seg);

    expect(blocks[0].output.length).toBeLessThanOrEqual(MAX_RETAINED_BYTES + 1024);
  });

  it('caps retention at 256KB', () => {
    expect(MAX_RETAINED_BYTES).toBe(256 * 1024);
  });
});
