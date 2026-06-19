import { describe, it, expect } from 'vitest';
import { BlockSegmenter } from '@/components/BlockSegmenter';

describe('SSH close hard-reset', () => {
  it('clears ssh session state even if depth counters drifted', () => {
    const seg = new BlockSegmenter();
    const ssh: boolean[] = [];
    seg.onSshSession((active: boolean) => ssh.push(active));

    // Simulate entering an ssh session with drifted depth counters (remote
    // command died before its OSC 133 D marker, leaving _cmdDepth inflated).
    (seg as any)._inSshSession = true;
    (seg as any)._sshDepth = 2;
    (seg as any)._cmdDepth = 5; // drifted — never decremented back below sshDepth

    // Feed the "Connection to X closed" line that ssh prints on teardown.
    // We route it as an output chunk via the internal _routeChunk so that
    // SSH_CLOSED_RE is evaluated exactly as production code does.
    // _osc133Phase must be 'output' for the chunk to hit the SSH_CLOSED_RE branch.
    (seg as any)._integrationActive = true;
    (seg as any)._osc133Phase = 'output';
    (seg as any)._routeChunk('Connection to host closed.\n');

    expect((seg as any)._inSshSession).toBe(false);
    expect((seg as any)._sshDepth).toBe(0);
    expect((seg as any)._cmdDepth).toBe(0);
    expect(ssh.at(-1)).toBe(false);
  });
});
