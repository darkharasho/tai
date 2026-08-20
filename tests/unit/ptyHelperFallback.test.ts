import { describe, it, expect, vi } from 'vitest';

// Simulate CI's Linux state: node-pty present but unloadable from plain Node.
vi.mock('node-pty', () => { throw new Error('NODE_MODULE_VERSION mismatch (simulated)'); });

describe('fallback when node-pty cannot load', () => {
  it('falls through to script(1) or skips loudly, never throws', async () => {
    const { runInPty } = await import('../helpers/scriptPty');
    const out = await runInPty('/bin/sh', ['-i'], 'echo fallback-ok\nexit\n', { timeoutMs: 5000 });
    // On macOS: BSD script is unusable, so null (skip). On Linux: a transcript.
    if (out === null) {
      expect(process.platform).not.toBe('linux');
    } else {
      expect(out).toContain('fallback-ok');
    }
  }, 20_000);
});
