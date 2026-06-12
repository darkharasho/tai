import { describe, it, expect } from 'vitest';
import { Terminal } from '@xterm/headless';
import { TermEmulator } from '@/utils/termEmulator';

/**
 * Oracle test: @xterm/headless is a real terminal implementation — feed the
 * same bytes to it and to TermEmulator and the visible text must match.
 * Catches silent divergence as the emulator grows. Corpus entries must keep
 * lines under the column width (xterm wraps; TermEmulator doesn't).
 */

async function xtermRender(raw: string): Promise<string> {
  const term = new Terminal({ cols: 200, rows: 50, allowProposedApi: true, scrollback: 1000 });
  await new Promise<void>(resolve => term.write(raw, resolve));
  const buf = term.buffer.active;
  const lines: string[] = [];
  for (let i = 0; i < buf.length; i++) {
    lines.push(buf.getLine(i)?.translateToString(true) ?? '');
  }
  term.dispose();
  return lines.join('\n').replace(/\s+$/, '');
}

function emulatorRender(raw: string): string {
  const emu = new TermEmulator();
  emu.feed(raw);
  return emu.text().replace(/\s+$/, '');
}

const CORPUS: Array<[name: string, bytes: string]> = [
  ['plain lines', 'one\r\ntwo\r\nthree\r\n'],
  ['cr overwrite', 'progress 10%\rprogress 99%\r\ndone\r\n'],
  ['backspace echo', 'f\bfrom collections import Counter\r\n'],
  ['erase to eol', 'a long line here\r\x1b[Kshort\r\n'],
  ['erase whole line', 'junk\x1b[2K\rclean\r\n'],
  ['cursor up redraw', 'prompt one\r\n\x1b[A\x1b[2K\rprompt two\r\n'],
  ['cursor back overwrite', 'abcdef\x1b[4Dxy\r\n'],
  ['cursor forward pad', 'ab\x1b[3Cz\r\n'],
  ['cursor to column', 'hello\x1b[1GJ\r\n'],
  ['insert chars', 'abcdef\x1b[3D\x1b[2@XY\r\n'],
  ['delete chars', 'abcdef\x1b[4D\x1b[2PZ\r\n'],
  ['erase chars', 'abcdef\x1b[4D\x1b[2X\r\n'],
  ['insert line', 'one\r\ntwo\x1b[A\r\x1b[LX\r\n'],
  ['delete line', 'one\r\ntwo\r\nthree\x1b[2A\r\x1b[M\r\n'],
  ['sgr colors', '\x1b[31mred\x1b[0m and \x1b[1;32mbold green\x1b[0m\r\n'],
  ['tabs', 'ab\tc\td\r\n'],
  ['mixed redraw storm', 'x\b\x1b[Kcmd one\r\n> y\b\x1b[Kecho hi\r\nhi\r\n'],
];

describe('TermEmulator vs @xterm/headless oracle', () => {
  for (const [name, bytes] of CORPUS) {
    it(`matches xterm: ${name}`, async () => {
      expect(emulatorRender(bytes)).toBe(await xtermRender(bytes));
    });
  }
});
