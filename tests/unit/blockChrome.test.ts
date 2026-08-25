import { describe, it, expect } from 'vitest';
import { formatClock, buildBlockTranscript } from '../../src/utils/blockChrome';

describe('formatClock', () => {
  it('zero-pads to a fixed-width 24h stamp', () => {
    const early = new Date(2024, 0, 2, 9, 5).getTime();
    expect(formatClock(early)).toBe('09:05');
  });

  it('uses 24h rather than am/pm', () => {
    const evening = new Date(2024, 0, 2, 14, 32).getTime();
    expect(formatClock(evening)).toBe('14:32');
  });

  it('every stamp is the same width, so a column of blocks stays aligned', () => {
    const widths = new Set(
      [0, 5, 9, 13, 23].map(h => formatClock(new Date(2024, 0, 2, h, 7).getTime()).length),
    );
    expect(widths).toEqual(new Set([5]));
  });

  it('renders nothing for a block with no usable start time', () => {
    expect(formatClock(0)).toBe('');
    expect(formatClock(NaN)).toBe('');
    expect(formatClock(-1)).toBe('');
  });
});

describe('buildBlockTranscript', () => {
  const base = { command: 'npm test', output: 'ok\n', exitCode: 0, cwd: undefined };

  it('fences the command and its output for pasting', () => {
    expect(buildBlockTranscript(base)).toBe('```console\n$ npm test\nok\n```');
  });

  it('prefixes the working directory when the block recorded one', () => {
    expect(buildBlockTranscript({ ...base, cwd: '~/tai' })).toContain('~/tai $ npm test');
  });

  it('strips ANSI so the paste is readable outside a terminal', () => {
    const out = buildBlockTranscript({ ...base, output: '\x1b[31mred\x1b[0m fail' });
    expect(out).toContain('red fail');
    expect(out).not.toContain('\x1b');
  });

  it('states a non-zero exit code, which the output alone may not show', () => {
    expect(buildBlockTranscript({ ...base, exitCode: 1 })).toContain('exit 1');
  });

  it('stays silent about a clean exit', () => {
    expect(buildBlockTranscript(base)).not.toContain('exit');
    expect(buildBlockTranscript({ ...base, exitCode: undefined })).not.toContain('exit');
  });

  it('closes the fence even when the command produced no output', () => {
    const out = buildBlockTranscript({ ...base, output: '' });
    expect(out).toBe('```console\n$ npm test\n```');
    expect(out.match(/```/g)).toHaveLength(2);
  });

  it('does not leave a blank line inside the fence from trailing newlines', () => {
    expect(buildBlockTranscript({ ...base, output: 'ok\n\n\n' })).toBe(
      '```console\n$ npm test\nok\n```',
    );
  });
});
