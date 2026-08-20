// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom';
import { render, fireEvent } from '@testing-library/react';
import { BlockList, type DisplayItem } from '../../src/components/BlockList';
import type { SegmentedBlock } from '../../src/types';

vi.mock('../../src/components/InlineAIBlock', () => ({
  InlineAIBlock: () => <div data-ai-stub />,
}));

function cmd(id: string): DisplayItem {
  return {
    type: 'command',
    block: {
      id, command: `c-${id}`, output: 'out', rawOutput: 'out', promptText: 'p $',
      startTime: 0, duration: 1, exitCode: 0, isRemote: false,
    } as SegmentedBlock,
  } as DisplayItem;
}

function ai(id: string): DisplayItem {
  return { type: 'ai', id, question: 'hi how are you', content: 'Doing well.' } as DisplayItem;
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

let scrollIntoView: ReturnType<typeof vi.fn>;

beforeEach(() => {
  scrollIntoView = vi.fn();
  Element.prototype.scrollIntoView = scrollIntoView;
});

/** Scroll the list up so the auto-follow pin is released, the way reading back
 *  through earlier output does. */
function scrollUp(container: HTMLElement) {
  const list = container.firstElementChild as HTMLElement;
  Object.defineProperty(list, 'scrollHeight', { value: 2000, configurable: true });
  Object.defineProperty(list, 'clientHeight', { value: 500, configurable: true });
  list.scrollTop = 0;
  fireEvent.scroll(list);
}

describe('BlockList re-pins on submit', () => {
  it('follows new items while pinned to the bottom', () => {
    const { rerender } = render(<BlockList {...baseProps} items={[cmd('a')]} />);
    scrollIntoView.mockClear();
    rerender(<BlockList {...baseProps} items={[cmd('a'), cmd('b')]} />);
    expect(scrollIntoView).toHaveBeenCalled();
  });

  it('stops following once the user scrolls up', () => {
    const { container, rerender } = render(<BlockList {...baseProps} items={[cmd('a')]} />);
    scrollUp(container);
    scrollIntoView.mockClear();
    rerender(<BlockList {...baseProps} items={[cmd('a'), cmd('b')]} />);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('re-pins when a submit lands, so the answer is not stranded off screen', () => {
    const { container, rerender } = render(
      <BlockList {...baseProps} items={[cmd('a')]} submitToken={0} />,
    );
    scrollUp(container);
    scrollIntoView.mockClear();

    // The submit both bumps the token and appends the turn.
    rerender(<BlockList {...baseProps} items={[cmd('a'), ai('q1')]} submitToken={1} />);
    expect(scrollIntoView).toHaveBeenCalled();
  });

  it('keeps following the answer as it streams in after a re-pin', () => {
    const { container, rerender } = render(
      <BlockList {...baseProps} items={[cmd('a')]} submitToken={0} />,
    );
    scrollUp(container);
    rerender(<BlockList {...baseProps} items={[cmd('a'), ai('q1')]} submitToken={1} />);
    scrollIntoView.mockClear();

    // Growth after the re-pin (streamed content) must still follow.
    rerender(<BlockList {...baseProps} items={[cmd('a'), ai('q1'), ai('q2')]} submitToken={1} />);
    expect(scrollIntoView).toHaveBeenCalled();
  });
});
