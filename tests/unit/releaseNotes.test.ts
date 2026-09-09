import { describe, it, expect } from 'vitest';
// @ts-expect-error - plain ESM script, no type declarations
import { buildReleaseNotes } from '../../scripts/release-notes.mjs';
import { hasRealNotes, compareSemver } from '@/hooks/useWhatsNew';

describe('buildReleaseNotes', () => {
  it('groups feat and fix into user-facing sections', () => {
    expect(
      buildReleaseNotes([
        'feat(sidebar): trade the inline block list for a sparkline and a flyout',
        "fix(termios): stop the shell's own line editor reading as a TUI",
      ]),
    ).toBe(
      "## What's New\n" +
        '- Trade the inline block list for a sparkline and a flyout\n' +
        '\n' +
        '## Bug Fixes\n' +
        "- Stop the shell's own line editor reading as a TUI",
    );
  });

  it('skips internal commit types and unconventional subjects', () => {
    expect(
      buildReleaseNotes([
        'chore: bump deps',
        'ci: pin windows runner',
        'docs: tidy readme',
        'release: v1.19.0',
        'merge branch master',
      ]),
    ).toBe('');
  });

  it('omits an empty section rather than emitting a bare heading', () => {
    expect(buildReleaseNotes(['fix: stop the crash'])).toBe('## Bug Fixes\n- Stop the crash');
  });

  it('handles breaking-change markers and de-duplicates entries', () => {
    expect(buildReleaseNotes(['feat!: drop legacy config', 'feat: drop legacy config'])).toBe(
      "## What's New\n- Drop legacy config",
    );
  });
});

describe('hasRealNotes', () => {
  it('rejects a --generate-notes body that is only a compare link', () => {
    expect(
      hasRealNotes('**Full Changelog**: https://github.com/darkharasho/tai/compare/v1.18.1...v1.19.0'),
    ).toBe(false);
  });

  it('rejects empty and missing bodies', () => {
    expect(hasRealNotes('')).toBe(false);
    expect(hasRealNotes('   \n  ')).toBe(false);
    expect(hasRealNotes(undefined)).toBe(false);
  });

  it('keeps real notes even when a changelog link is appended', () => {
    expect(
      hasRealNotes('## Bug Fixes\n- Fixed a thing\n\n**Full Changelog**: https://example.com/compare'),
    ).toBe(true);
  });
});

describe('compareSemver', () => {
  it('orders versions and tolerates a leading v', () => {
    expect(compareSemver('v1.19.0', '1.18.1')).toBeGreaterThan(0);
    expect(compareSemver('1.9.0', '1.10.0')).toBeLessThan(0);
    expect(compareSemver('v1.19.0', '1.19.0')).toBe(0);
  });
});
