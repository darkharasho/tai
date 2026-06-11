// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import '@testing-library/jest-dom';
import { render } from '@testing-library/react';
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

  it('keeps in-list active cards on the normal output path', () => {
    const { container } = render(
      <CommandBlock block={makeBlock()} active isActive ptyId={1} {...base} />,
    );
    expect(container.querySelector('[class*="liveOutput"]')).toBeNull();
  });
});
