import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { completePathInsensitive, recaseEntry } from '../../electron/services/pty';

let root: string;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'tai-complete-'));
  fs.mkdirSync(path.join(root, 'Documents'));
  fs.mkdirSync(path.join(root, 'Documents', 'GitHub'));
  fs.mkdirSync(path.join(root, 'Downloads'));
  fs.writeFileSync(path.join(root, 'Doc-notes.md'), 'x');
  fs.writeFileSync(path.join(root, '.dotfile'), 'x');
  fs.mkdirSync(path.join(root, '.hidden-dir'));
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('completePathInsensitive', () => {
  it('matches a lowercase token against a capitalised directory', () => {
    // The whole point: `compgen -d -- 'docu'` returns nothing here.
    expect(completePathInsensitive(root, 'docu', { dirsOnly: true })).toEqual(['Documents/']);
  });

  it('returns the entry\'s real name, so the line gets re-cased', () => {
    const [only] = completePathInsensitive(root, 'documents', { dirsOnly: true });
    expect(only).toBe('Documents/');
  });

  it('marks directories with a trailing slash and leaves files bare', () => {
    const out = completePathInsensitive(root, 'doc', { dirsOnly: false });
    expect(out).toContain('Documents/');
    expect(out).toContain('Doc-notes.md');
  });

  it('omits files entirely for a dirs-only command', () => {
    const out = completePathInsensitive(root, 'doc', { dirsOnly: true });
    expect(out).toContain('Documents/');
    expect(out).not.toContain('Doc-notes.md');
  });

  it('descends into an already-typed path segment, preserving what was typed', () => {
    expect(completePathInsensitive(root, 'Documents/git', { dirsOnly: true }))
      .toEqual(['Documents/GitHub/']);
  });

  it('hides dotfiles until the leading dot is typed', () => {
    const bare = completePathInsensitive(root, '', { dirsOnly: false });
    expect(bare).not.toContain('.dotfile');
    const dotted = completePathInsensitive(root, '.', { dirsOnly: false });
    expect(dotted).toContain('.dotfile');
    expect(dotted).toContain('.hidden-dir/');
  });

  it('returns several candidates when the token is ambiguous', () => {
    expect(completePathInsensitive(root, 'do', { dirsOnly: true }).sort())
      .toEqual(['Documents/', 'Downloads/']);
  });

  it('returns nothing for an unreadable directory instead of throwing', () => {
    expect(completePathInsensitive(path.join(root, 'nope'), 'x', { dirsOnly: false })).toEqual([]);
  });
});

describe('re-casing already-typed segments', () => {
  it('rewrites the whole path, not just the segment being completed', () => {
    expect(completePathInsensitive(root, 'documents/git', { dirsOnly: true }))
      .toEqual(['Documents/GitHub/']);
  });

  it('leaves a correctly-cased path untouched', () => {
    expect(completePathInsensitive(root, 'Documents/Git', { dirsOnly: true }))
      .toEqual(['Documents/GitHub/']);
  });

  it('completes the contents of a fully-typed lowercase directory', () => {
    expect(completePathInsensitive(root, 'documents/', { dirsOnly: true }))
      .toEqual(['Documents/GitHub/']);
  });

  it('keeps segments that do not resolve exactly as typed', () => {
    expect(completePathInsensitive(root, 'nosuchdir/x', { dirsOnly: false })).toEqual([]);
  });
});

describe('recaseEntry (applied to bash\'s own output)', () => {
  it('re-cases a candidate bash echoed back in the typed casing', () => {
    // What `compgen -d -- 'documents/github/ta'` returns on a case-insensitive
    // volume: the typed casing, verbatim.
    expect(recaseEntry(root, 'documents/github/')).toBe('Documents/GitHub/');
  });

  it('preserves the directory marker and leaves files bare', () => {
    expect(recaseEntry(root, 'doc-notes.md')).toBe('Doc-notes.md');
    expect(recaseEntry(root, 'documents/')).toBe('Documents/');
  });

  it('leaves an already-correct candidate untouched', () => {
    expect(recaseEntry(root, 'Documents/GitHub/')).toBe('Documents/GitHub/');
  });

  it('keeps unresolvable segments as they are', () => {
    expect(recaseEntry(root, 'nosuch/thing')).toBe('nosuch/thing');
  });
});

// NOTE: the "re-casing already-typed segments" cases above are the guard for
// case-sensitive filesystems. They pass on macOS whether or not the search
// directory is re-cased, because the volume resolves `documents/` to
// `Documents/` itself — on Linux they fail unless it is. CI is what enforces
// them; do not "simplify" them away because they look redundant here.
