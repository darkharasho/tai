import { describe, it, expect } from 'vitest';
import { PtyRecorder, parseRecording } from '@/utils/ptyRecording';
import { replayRecording } from '../helpers/replayPty';

function osc133(letter: string) {
  return `\x1b]133;${letter}\x07`;
}

describe('replayRecording', () => {
  it('reproduces blocks from a recorded integrated session', () => {
    const rec = new PtyRecorder(() => 0);
    rec.data(osc133('A'));
    rec.data('mike@host:~$ ');
    rec.data(osc133('B'));
    rec.data('echo hi\n');
    rec.data(osc133('C'));
    rec.data('hi\n');
    rec.data(osc133('D;0'));
    rec.data(osc133('A'));
    rec.data('mike@host:~$ ');
    rec.data(osc133('B'));

    const result = replayRecording(parseRecording(rec.serialize()));

    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].command).toBe('echo hi');
    expect(result.blocks[0].output).toBe('hi');
    expect(result.blocks[0].exitCode).toBe(0);
  });

  it('preserves the original chunk boundaries', () => {
    // The alt-screen enter sequence is split across two chunks. This only
    // resolves correctly if the replay feeds the chunks exactly as recorded —
    // the segmenter's _altScreenTail lookback is what stitches it.
    const rec = new PtyRecorder(() => 0);
    rec.data(osc133('A'));
    rec.data('$ ');
    rec.data(osc133('B'));
    rec.data('htop\n');
    rec.data(osc133('C'));
    rec.data('\x1b[?');
    rec.data('1049h');

    const result = replayRecording(parseRecording(rec.serialize()));

    expect(result.transitions).toContain('altScreen:true');
  });

  it('records termios transitions into the timeline with their timestamps', () => {
    const rec = new PtyRecorder(() => 0);
    rec.termios(false, true);   // raw mode
    rec.termios(true, false);   // password prompt shape
    rec.termios(true, true);    // back to cooked

    const result = replayRecording(parseRecording(rec.serialize()));

    expect(result.transitions).toEqual([
      'termios:raw',
      'termios:password',
      'termios:cooked',
    ]);
    expect(result.timeline.every(e => typeof e.t === 'number')).toBe(true);
  });

  it('interleaves termios events with data in recorded order', () => {
    const rec = new PtyRecorder(() => 0);
    rec.data(osc133('A'));
    rec.data('$ ');
    rec.data(osc133('B'));
    rec.data('claude\n');
    rec.data(osc133('C'));
    rec.data('\x1b[2A');        // TUI reposition — inferred flip, fires first
    rec.termios(false, true);   // termios confirms, 700ms later in real life

    const result = replayRecording(parseRecording(rec.serialize()));

    expect(result.transitions).toEqual(['altScreen:true', 'termios:raw']);
  });

  it('returns an empty result for an empty recording', () => {
    const result = replayRecording({ entries: [] });
    expect(result.blocks).toEqual([]);
    expect(result.transitions).toEqual([]);
  });
});
