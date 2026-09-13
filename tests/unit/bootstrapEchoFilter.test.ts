import { describe, it, expect } from 'vitest';
import { BootstrapEchoFilter, ERASE_LINE } from '../../electron/services/bootstrapEchoFilter';

const CMD = " . '/opt/tai/resources/shell-integration/tai-bash.sh'";
const PROMPT = '\x1b[32mme@host\x1b[0m:~$ ';

describe('BootstrapEchoFilter', () => {
  it('passes data through untouched until armed', () => {
    const f = new BootstrapEchoFilter();
    expect(f.process('motd\r\n' + PROMPT)).toBe('motd\r\n' + PROMPT);
  });

  it('drops the echoed source line and clears the prompt it sat on', () => {
    const f = new BootstrapEchoFilter();
    f.arm(CMD);
    const out = f.process(`${CMD}\r\n\x1b[?2004l\r`) + f.process(`\x1b]133;A\x07${PROMPT}`);
    expect(out).toBe(`${ERASE_LINE}\x1b[?2004l\r\x1b]133;A\x07${PROMPT}`);
    expect(f.armed).toBe(false);
  });

  it('matches an echo split across chunks', () => {
    const f = new BootstrapEchoFilter();
    f.arm(CMD);
    expect(f.process(CMD.slice(0, 10))).toBe('');
    expect(f.process(CMD.slice(10) + '\r')).toBe('');
    expect(f.process('\nnext')).toBe(`${ERASE_LINE}next`);
  });

  it('keeps late prompt bytes that arrive before the echo', () => {
    const f = new BootstrapEchoFilter();
    f.arm(CMD);
    expect(f.process(`$ ${CMD}\r\n`)).toBe(`$ ${ERASE_LINE}`);
  });

  it('releases held output unchanged when the echo never shows up', () => {
    const f = new BootstrapEchoFilter();
    f.arm(CMD);
    expect(f.process('some rc output')).toBe('');
    expect(f.flush()).toBe('some rc output');
    expect(f.armed).toBe(false);
    expect(f.process('more')).toBe('more');
  });

  it('gives up once far more than the echo has been held', () => {
    const f = new BootstrapEchoFilter();
    f.arm(CMD);
    const big = 'x'.repeat(CMD.length + 5000);
    expect(f.process(big)).toBe(big);
    expect(f.armed).toBe(false);
  });

  it('never drops a command that only mentions the script', () => {
    const f = new BootstrapEchoFilter();
    f.arm(CMD);
    const other = "cat '/opt/tai/resources/shell-integration/tai-bash.sh'\r\n";
    expect(f.process(other) + f.flush()).toBe(other);
  });
});
