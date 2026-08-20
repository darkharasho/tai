// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import '@testing-library/jest-dom';
import { render } from '@testing-library/react';
import { CommandBlock } from '../../src/components/CommandBlock';
import type { SegmentedBlock } from '../../src/types';

function makeBlock(extra: Partial<SegmentedBlock> = {}): SegmentedBlock {
  return {
    id: 'b1',
    command: 'git status',
    output: 'clean',
    rawOutput: 'clean',
    promptText: 'me@host ~/proj $',
    startTime: 0,
    duration: 10,
    exitCode: 0,
    isRemote: false,
    ...extra,
  } as SegmentedBlock;
}

const noop = () => {};
const base = { onCopy: noop, onAskAI: noop, onRerun: noop };

describe('CommandBlock git branch', () => {
  // The branch moved out of its own pill and into Warp's muted meta line,
  // where it reads as the shell would print it: git:(branch).
  it('shows the git branch when present on the block', () => {
    const { container } = render(
      <CommandBlock block={makeBlock({ gitBranch: 'feature/x' })} {...base} />,
    );
    const git = container.querySelector('[class*="metaGit"]');
    expect(git).toBeTruthy();
    expect(git!.textContent).toBe('git:(feature/x)');
  });

  it('shows nothing without a branch', () => {
    const { container } = render(<CommandBlock block={makeBlock()} {...base} />);
    expect(container.querySelector('[class*="metaGit"]')).toBeNull();
  });

  it('exposes the post-exec cwd as a tooltip on the path', () => {
    const { container } = render(
      <CommandBlock block={makeBlock({ cwd: '/var/home/me/proj' })} {...base} />,
    );
    expect(container.querySelector('[title="/var/home/me/proj"]')).toBeTruthy();
  });
});
