// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom';
import { render } from '@testing-library/react';
import { BlockList, type DisplayItem } from '../../src/components/BlockList';
import type { SegmentedBlock } from '../../src/types';

vi.mock('../../src/components/InlineAIBlock', () => ({
  InlineAIBlock: () => <div />,
}));

function cmd(id: string, active?: boolean): DisplayItem {
  return {
    type: 'command',
    active,
    block: { id, command: `c-${id}`, output: 'out', rawOutput: 'out', promptText: 'p $', startTime: 0, duration: 1, exitCode: 0, isRemote: false } as SegmentedBlock,
  } as DisplayItem;
}

const noop = () => {};
const baseProps = {
  activeBlockId: null,
  onCopy: noop,
  onAskAI: noop,
  onRerun: noop,
  onRunSuggested: noop,
  onToolApprove: noop,
  onToolReject: noop,
};

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

describe('BlockList render windowing', () => {
  it('marks finished history cards for offscreen render skipping', () => {
    const { container } = render(<BlockList {...baseProps} items={[cmd('a'), cmd('b', true)]} />);
    const a = container.querySelector('[data-item-id="a"]') as HTMLElement;
    const b = container.querySelector('[data-item-id="b"]') as HTMLElement;
    expect(a.className).toContain('cardWindow');
    expect(b.className).not.toContain('cardWindow');
  });
});
