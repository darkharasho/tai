import { describe, it, expect } from 'vitest';
import { parseHistoryFile, unmetafyZsh } from '../../electron/services/parseShellHistory';

describe('parseHistoryFile', () => {
  it('parses plain bash history', () => {
    expect(parseHistoryFile('ls -la\ngit status\n')).toEqual(['ls -la', 'git status']);
  });

  it('strips zsh extended-history prefixes', () => {
    expect(parseHistoryFile(': 1718000000:0;ls -la\n: 1718000005:2;npm test\n'))
      .toEqual(['ls -la', 'npm test']);
  });

  it('keeps a zsh multi-line heredoc as ONE entry', () => {
    const file =
      ": 1718000000:0;python3 - <<'EOF'\\\n" +
      'from collections import Counter\\\n' +
      'print(Counter())\\\n' +
      'EOF\n' +
      ': 1718000010:0;ls\n';
    expect(parseHistoryFile(file)).toEqual([
      "python3 - <<'EOF'\nfrom collections import Counter\nprint(Counter())\nEOF",
      'ls',
    ]);
  });

  it('keeps a multi-line for loop as one entry', () => {
    const file = ': 1:0;for i in 1 2; do\\\necho $i\\\ndone\n';
    expect(parseHistoryFile(file)).toEqual(['for i in 1 2; do\necho $i\ndone']);
  });

  it('drops bash HISTTIMEFORMAT timestamp comments', () => {
    expect(parseHistoryFile('#1718000000\nls -la\n#1718000005\ngit log\n'))
      .toEqual(['ls -la', 'git log']);
  });

  it('does not drop real comment commands', () => {
    expect(parseHistoryFile('# note to self\n')).toEqual(['# note to self']);
  });

  it('does not treat an escaped trailing backslash as a continuation', () => {
    expect(parseHistoryFile(': 1:0;echo foo\\\\\nls\n')).toEqual(['echo foo\\\\', 'ls']);
  });

  it('skips blank lines', () => {
    expect(parseHistoryFile('ls\n\n\ngit status\n')).toEqual(['ls', 'git status']);
  });
});

describe('unmetafyZsh', () => {
  it('passes plain ascii through', () => {
    expect(unmetafyZsh(Buffer.from('ls -la\n'))).toBe('ls -la\n');
  });

  it('decodes metafied multibyte characters', () => {
    // zsh stores bytes >= 0x80 as 0x83 followed by byte^0x20.
    const utf8 = Buffer.from('echo "héllo"\n', 'utf8');
    const metafied: number[] = [];
    for (const b of utf8) {
      if (b >= 0x80) { metafied.push(0x83, b ^ 0x20); } else { metafied.push(b); }
    }
    expect(unmetafyZsh(Buffer.from(metafied))).toBe('echo "héllo"\n');
  });
});
