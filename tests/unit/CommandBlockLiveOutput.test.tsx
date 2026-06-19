// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import '@testing-library/jest-dom';
import { render, fireEvent } from '@testing-library/react';
import { CommandBlock } from '../../src/components/CommandBlock';
import type { SegmentedBlock } from '../../src/types';

function makeBlock(lines = 100): SegmentedBlock {
  const output = Array.from({ length: lines }, (_, i) => `line${i + 1}`).join('\n');
  return {
    id: 'b1',
    command: 'rails server',
    output,
    rawOutput: output,
    promptText: 'me@host ~/app $',
    startTime: 0,
    duration: 0,
    isRemote: false,
  } as SegmentedBlock;
}

const noop = () => {};
const base = { onCopy: noop, onAskAI: noop, onRerun: noop };

describe('pinned live card output containment', () => {
  it('bounds the pinned live card and makes its output internally scrollable', () => {
    const { container } = render(
      <CommandBlock block={makeBlock()} active isActive ptyId={1} docked sessionKind="server" onStop={noop} {...base} />,
    );
    expect(container.querySelector('[class*="liveOutput"]')).toBeTruthy();
    const card = container.querySelector('[data-card-surface]') as HTMLElement;
    expect(card.style.maxHeight).not.toBe('');
    // the stdin line must still be rendered below the scrollable output
    expect(container.querySelector('[class*="cardInput"]')).toBeTruthy();
  });

  it('omits the flex spacer on pinned live cards so output fills the card', () => {
    const { container } = render(
      <CommandBlock block={makeBlock()} active isActive ptyId={1} docked sessionKind="server" onStop={noop} {...base} />,
    );
    expect(container.querySelector('[class*="activeOutputSpacer"]')).toBeNull();
    expect(container.querySelector('[class*="cardInput"]')).toBeTruthy();
  });

  it('in-list active session cards grow with the scrollback (no inner scroll)', () => {
    const { container } = render(
      <CommandBlock block={makeBlock()} active isActive ptyId={1} sessionKind="server" onStop={noop} {...base} />,
    );
    expect(container.querySelector('[class*="liveOutput"]')).toBeNull();
    expect(container.querySelector('[class*="activeOutputSpacer"]')).toBeNull();
    expect(container.querySelector('[class*="cardInput"]')).toBeTruthy();
  });

  it('renders finished session blocks fully expanded (all lines)', () => {
    const block = { ...makeBlock(100), id: 'done-1', sessionKind: 'watch' as const, exitCode: 130 };
    const { container } = render(<CommandBlock block={block} {...base} />);
    // 100 lines is beyond the 30-line clamp — a session block shows them all.
    expect(container.textContent).toContain('line100');
    expect(container.textContent).toContain('line1');
  });

  it('still clamps long non-session output to the head when collapsed', () => {
    const { container } = render(<CommandBlock block={makeBlock(100)} {...base} />);
    // Long output now opens fully expanded; collapse via the expander to clamp.
    const expander = container.querySelector('[class*="showMore"]') as HTMLElement;
    fireEvent.click(expander);
    expect(container.textContent).toContain('line1');
    expect(container.textContent).not.toContain('line100');
  });

  it('keeps the spacer for a session card with no output yet', () => {
    const { container } = render(
      <CommandBlock block={{ ...makeBlock(), output: '', rawOutput: '' }} active isActive ptyId={1} sessionKind="server" onStop={noop} {...base} />,
    );
    expect(container.querySelector('[class*="activeOutputSpacer"]')).toBeTruthy();
  });

  it('renders plain running commands flat — no stdin box, no spacer', () => {
    const { container } = render(
      <CommandBlock block={makeBlock()} active isActive ptyId={1} {...base} />,
    );
    expect(container.querySelector('[class*="cardInputBox"]')).toBeNull();
    expect(container.querySelector('[class*="activeOutputSpacer"]')).toBeNull();
    expect(container.querySelector('[class*="blockCard"]')).toBeNull();
  });

  it('keeps in-list active cards on the normal output path', () => {
    const { container } = render(
      <CommandBlock block={makeBlock()} active isActive ptyId={1} {...base} />,
    );
    expect(container.querySelector('[class*="liveOutput"]')).toBeNull();
  });
});
