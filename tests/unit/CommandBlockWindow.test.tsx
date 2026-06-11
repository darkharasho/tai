// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import '@testing-library/jest-dom';
import { render, fireEvent } from '@testing-library/react';
import { CommandBlock } from '../../src/components/CommandBlock';
import type { SegmentedBlock } from '../../src/types';

function makeBlock(lines: number): SegmentedBlock {
  const output = Array.from({ length: lines }, (_, i) => `line${i + 1}`).join('\n');
  return {
    id: 'b1',
    command: 'big',
    output,
    rawOutput: output,
    promptText: 'me@host ~ $',
    startTime: 0,
    duration: 10,
    exitCode: 0,
    isRemote: false,
  } as SegmentedBlock;
}

const noop = () => {};
const base = { onCopy: noop, onAskAI: noop, onRerun: noop };

function renderedLines(container: HTMLElement): string[] {
  const out = container.querySelector('[class*="output"]');
  return (out?.textContent ?? '').split('\n').filter(Boolean);
}

describe('CommandBlock output windowing', () => {
  it('renders a finished long output clamped to a bounded number of DOM lines', () => {
    const { container } = render(<CommandBlock block={makeBlock(500)} {...base} />);
    const lines = renderedLines(container);
    expect(lines.length).toBeLessThanOrEqual(40);
    expect(lines[0]).toBe('line1');
    // expander still reports the true total
    expect(container.textContent).toContain('500 lines');
  });

  it('renders full output when expanded via show-all', () => {
    const { container } = render(<CommandBlock block={makeBlock(60)} {...base} />);
    const expander = container.querySelector('[class*="showMore"]') as HTMLElement;
    fireEvent.click(expander);
    expect(renderedLines(container)).toHaveLength(60);
  });

  it('renders only the tail window for an active streaming card', () => {
    const { container } = render(
      <CommandBlock block={makeBlock(3000)} active isActive {...base} />,
    );
    const lines = renderedLines(container);
    expect(lines.length).toBeLessThanOrEqual(600);
    expect(lines[lines.length - 1]).toBe('line3000');
  });

  it('renders short outputs untouched', () => {
    const { container } = render(<CommandBlock block={makeBlock(5)} {...base} />);
    expect(renderedLines(container)).toHaveLength(5);
  });
});
