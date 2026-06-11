// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom';
import { render, fireEvent } from '@testing-library/react';
import { BlockList, type DisplayItem } from '../../src/components/BlockList';
import type { SegmentedBlock } from '../../src/types';

vi.mock('../../src/components/InlineAIBlock', () => ({
  InlineAIBlock: () => <div />,
}));

function cmd(id: string, restored?: boolean): DisplayItem {
  return {
    type: 'command',
    restored,
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

describe('BlockList restored cards', () => {
  it('renders restored cards collapsed by default', () => {
    const { container } = render(<BlockList {...baseProps} items={[cmd('a', true), cmd('b')]} />);
    const collapsed = container.querySelectorAll('[class*="collapsed"]');
    expect(collapsed).toHaveLength(1);
    expect(collapsed[0].textContent).toContain('c-a');
  });

  it('expands a restored card on toggle', () => {
    const { container } = render(<BlockList {...baseProps} items={[cmd('a', true)]} />);
    fireEvent.click(container.querySelector('[class*="collapsed"]')!);
    expect(container.querySelector('[data-card-surface]')).toBeTruthy();
  });
});
