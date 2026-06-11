// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom';
import { render, fireEvent } from '@testing-library/react';
import { BlockList, type DisplayItem } from '../../src/components/BlockList';
import type { SegmentedBlock } from '../../src/types';

vi.mock('../../src/components/InlineAIBlock', () => ({
  InlineAIBlock: ({ question }: { question: string }) => <div data-testid="ai-block">{question}</div>,
}));

function makeBlock(id: string, output = 'hello'): SegmentedBlock {
  return {
    id,
    command: `cmd-${id}`,
    output,
    rawOutput: output,
    promptText: 'me@host ~ $',
    startTime: 0,
    duration: 10,
    exitCode: 0,
    isRemote: false,
  } as SegmentedBlock;
}

function cmdItem(id: string, extra: Partial<DisplayItem & { type: 'command' }> = {}): DisplayItem {
  return { type: 'command', block: makeBlock(id), ...extra } as DisplayItem;
}

function aiItem(id: string, streaming = false): DisplayItem {
  return { type: 'ai', id, question: `q-${id}`, content: 'a', suggestedCommands: [], streaming };
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

function setScrollMetrics(el: HTMLElement, { scrollTop, scrollHeight, clientHeight }: { scrollTop: number; scrollHeight: number; clientHeight: number }) {
  Object.defineProperty(el, 'scrollTop', { value: scrollTop, configurable: true, writable: true });
  Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true });
}

describe('BlockList auto-scroll', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('auto-scrolls on new items while pinned to the bottom', () => {
    const { rerender } = render(<BlockList {...baseProps} items={[cmdItem('a')]} />);
    (Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mockClear();

    rerender(<BlockList {...baseProps} items={[cmdItem('a'), cmdItem('b')]} />);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it('does not auto-scroll when the user has scrolled up into history', () => {
    const { container, rerender } = render(<BlockList {...baseProps} items={[cmdItem('a')]} />);
    const list = container.firstElementChild as HTMLElement;

    setScrollMetrics(list, { scrollTop: 0, scrollHeight: 2000, clientHeight: 400 });
    fireEvent.scroll(list);
    (Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mockClear();

    rerender(<BlockList {...baseProps} items={[cmdItem('a'), cmdItem('b')]} />);
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });

  it('resumes auto-scroll after the user returns to the bottom', () => {
    const { container, rerender } = render(<BlockList {...baseProps} items={[cmdItem('a')]} />);
    const list = container.firstElementChild as HTMLElement;

    setScrollMetrics(list, { scrollTop: 0, scrollHeight: 2000, clientHeight: 400 });
    fireEvent.scroll(list);
    setScrollMetrics(list, { scrollTop: 1600, scrollHeight: 2000, clientHeight: 400 });
    fireEvent.scroll(list);
    (Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mockClear();

    rerender(<BlockList {...baseProps} items={[cmdItem('a'), cmdItem('b')]} />);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });
});

describe('BlockList AI conversation identity', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('keeps the conversation container mounted when a follow-up is appended', () => {
    const { container, rerender } = render(<BlockList {...baseProps} items={[aiItem('ai1')]} />);
    const conversation = container.querySelector('[class*="conversation"]');
    expect(conversation).toBeTruthy();

    rerender(<BlockList {...baseProps} items={[aiItem('ai1'), aiItem('ai2')]} />);
    const after = container.querySelector('[class*="conversation"]');
    expect(after).toBe(conversation);
    expect(container.querySelectorAll('[data-testid="ai-block"]')).toHaveLength(2);
  });
});
