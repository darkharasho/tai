// tests/unit/tempCleanup.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { purgeStaleTempFiles } from '../../electron/services/tempCleanup';

describe('purgeStaleTempFiles', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taitest-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('removes stale tai temp files but keeps fresh and unrelated ones', () => {
    const stale = path.join(dir, 'tai-mcp-server-old.cjs');
    const fresh = path.join(dir, 'tai-mcp-server-new.cjs');
    const other = path.join(dir, 'unrelated.txt');
    fs.writeFileSync(stale, 'x'); fs.writeFileSync(fresh, 'x'); fs.writeFileSync(other, 'x');
    const old = Date.now() - 2 * 24 * 3600 * 1000;
    fs.utimesSync(stale, old / 1000, old / 1000);

    const removed = purgeStaleTempFiles(dir, Date.now(), 24 * 3600 * 1000);

    expect(removed).toBe(1);
    expect(fs.existsSync(stale)).toBe(false);
    expect(fs.existsSync(fresh)).toBe(true);
    expect(fs.existsSync(other)).toBe(true);
  });
});
