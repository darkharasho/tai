import { describe, it, expect } from 'vitest';
import { TermEmulator, renderTermText } from '@/utils/termEmulator';

describe('TermEmulator', () => {
  it('passes plain multiline text through', () => {
    const emu = new TermEmulator();
    emu.feed('hello\nworld\n');
    expect(emu.text()).toBe('hello\nworld\n');
  });

  it('overwrites on carriage return', () => {
    const emu = new TermEmulator();
    emu.feed('progress 50%\rprogress 99%\n');
    expect(emu.text()).toBe('progress 99%\n');
  });

  it('treats \\r\\n as a plain newline', () => {
    const emu = new TermEmulator();
    emu.feed('one\r\ntwo\r\n');
    expect(emu.text()).toBe('one\ntwo\n');
  });

  it('applies backspace overwrite (zsh keystroke echo)', () => {
    // zsh echoes the first typed char, backspaces, then redraws the line.
    const emu = new TermEmulator();
    emu.feed('f\x08from collections import Counter\n');
    expect(emu.text()).toBe('from collections import Counter\n');
  });

  it('drops BEL and other stray C0 control bytes', () => {
    const emu = new TermEmulator();
    emu.feed('done\x07ok\x00\x01\n');
    expect(emu.text()).toBe('doneok\n');
  });

  it('erases to end of line with ESC[K', () => {
    const emu = new TermEmulator();
    emu.feed('a very long line\r\x1b[Kshort\n');
    expect(emu.text()).toBe('short\n');
  });

  it('erases the whole line with ESC[2K', () => {
    const emu = new TermEmulator();
    emu.feed('garbage\x1b[2K\rclean\n');
    expect(emu.text()).toBe('clean\n');
  });

  it('collapses a cursor-up prompt redraw into one line', () => {
    // zsh redrawing prompt + RPROMPT: prints prompt, newline, cursor-up,
    // erase, prints prompt again. Naive stripping concatenates the copies.
    const emu = new TermEmulator();
    emu.feed('user@host ❯ \n\x1b[A\x1b[2K\ruser@host ❯ ls\n');
    expect(emu.text()).toBe('user@host ❯ ls\n');
  });

  it('does not duplicate a thrice-redrawn prompt', () => {
    const emu = new TermEmulator();
    const prompt = 'piclock@piclock ~/axitools ❯❯❯ ';
    emu.feed(`${prompt}\r\x1b[K${prompt}\r\x1b[K${prompt}cmd\n`);
    expect(emu.text()).toBe(`${prompt}cmd\n`);
  });

  it('handles cursor-back ESC[nD with overwrite', () => {
    const emu = new TermEmulator();
    emu.feed('abcdef\x1b[4Dxy\n');
    expect(emu.text()).toBe('abxyef\n');
  });

  it('handles cursor-forward ESC[nC by padding', () => {
    const emu = new TermEmulator();
    emu.feed('ab\x1b[3Cz\n');
    expect(emu.text()).toBe('ab   z\n');
  });

  it('handles cursor-to-column ESC[G', () => {
    const emu = new TermEmulator();
    emu.feed('hello\x1b[1GJ\n');
    expect(emu.text()).toBe('Jello\n');
  });

  it('clears everything on ESC[2J', () => {
    const emu = new TermEmulator();
    emu.feed('old stuff\nmore\n\x1b[H\x1b[2Jfresh');
    expect(emu.text()).toBe('fresh');
  });

  it('expands tabs to 8-column stops', () => {
    const emu = new TermEmulator();
    emu.feed('ab\tc\n');
    expect(emu.text()).toBe('ab      c\n');
  });

  it('preserves SGR color in ansi() output', () => {
    const emu = new TermEmulator();
    emu.feed('\x1b[31mred\x1b[0m plain\n');
    const ansi = emu.ansi();
    expect(ansi).toContain('\x1b[31m');
    expect(ansi).toContain('red');
    expect(ansi.replace(/\x1b\[[0-9;]*m/g, '')).toBe('red plain\n');
  });

  it('keeps color through an overwrite', () => {
    const emu = new TermEmulator();
    emu.feed('\x1b[32mgreen\x1b[0m\r\x1b[31mred\x1b[K\x1b[0m\n');
    const ansi = emu.ansi();
    expect(ansi).toContain('\x1b[31m');
    expect(ansi.replace(/\x1b\[[0-9;]*m/g, '')).toBe('red\n');
    expect(ansi).not.toContain('green');
  });

  it('handles escape sequences split across feeds', () => {
    const emu = new TermEmulator();
    emu.feed('hi\x1b[3');
    emu.feed('1mred\x1b[0m\n');
    expect(emu.text()).toBe('hired\n');
    expect(emu.ansi()).toContain('\x1b[31m');
  });

  it('drops OSC sequences entirely', () => {
    const emu = new TermEmulator();
    emu.feed('\x1b]0;window title\x07hello\n');
    expect(emu.text()).toBe('hello\n');
  });

  it('ignores private-mode sequences like cursor hide/show', () => {
    const emu = new TermEmulator();
    emu.feed('\x1b[?25lhidden\x1b[?25h\n');
    expect(emu.text()).toBe('hidden\n');
  });

  it('exposes the current (cursor) line for prompt detection', () => {
    const emu = new TermEmulator();
    emu.feed('out\nuser@host:~$ ');
    expect(emu.currentLine()).toBe('user@host:~$ ');
    expect(emu.completedText()).toBe('out');
  });

  it('renderTermText one-shot helper works', () => {
    expect(renderTermText('a\x08b\rc\x1b[K\n')).toBe('c\n');
  });

  it('reset clears all state', () => {
    const emu = new TermEmulator();
    emu.feed('stuff\n');
    emu.reset();
    expect(emu.text()).toBe('');
    emu.feed('new');
    expect(emu.text()).toBe('new');
  });
});
