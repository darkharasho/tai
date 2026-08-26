// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
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
  it('renders every card expanded, restored history included', () => {
    const { container } = render(<BlockList {...baseProps} items={[cmd('a', true), cmd('b')]} />);
    expect(container.querySelectorAll('[data-collapsed]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-card-surface]')).toHaveLength(2);
  });

  it('collapses a card on request, and only that card', () => {
    const { container } = render(
      <BlockList {...baseProps} items={[cmd('a', true), cmd('b', true)]} />,
    );
    fireEvent.contextMenu(container.querySelectorAll('[data-card-surface]')[0]);
    fireEvent.click(screen.getByText('Collapse block'));
    const collapsed = container.querySelectorAll('[data-collapsed]');
    expect(collapsed).toHaveLength(1);
    expect(collapsed[0].textContent).toContain('c-a');
  });
});
