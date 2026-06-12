// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom';
import { render } from '@testing-library/react';
import { BlockList, type DisplayItem } from '../../src/components/BlockList';
import type { SegmentedBlock } from '../../src/types';

function makeBlock(id: string, startTime: number, isRemote = false): SegmentedBlock {
  return {
    id,
    command: `cmd-${id}`,
    output: 'out',
    rawOutput: 'out',
    promptText: 'me@host ~ $',
    startTime,
    duration: 10,
    exitCode: 0,
    isRemote,
  } as SegmentedBlock;
}

function cmdItem(block: SegmentedBlock): DisplayItem {
  return { type: 'command', block } as DisplayItem;
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

describe('remote accent does not retro-color history', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('only blocks started after sessionRemoteSince wear the agent accent', () => {
    const before = makeBlock('old', 1_000);
    const after = makeBlock('new', 3_000);
    const { container } = render(
      <BlockList {...baseProps} items={[cmdItem(before), cmdItem(after)]} sessionRemoteSince={2_000} />,
    );
    const surfaces = container.querySelectorAll('[data-card-surface]');
    expect(surfaces.length).toBe(2);
    const styleOf = (el: Element) => el.getAttribute('style') ?? '';
    expect(styleOf(surfaces[0])).toContain('--color-shell');
    expect(styleOf(surfaces[0])).not.toContain('--color-agent');
    expect(styleOf(surfaces[1])).toContain('--color-agent');
  });

  it('keeps everything local when the session is not remote', () => {
    const { container } = render(
      <BlockList {...baseProps} items={[cmdItem(makeBlock('a', 1_000))]} sessionRemoteSince={null} />,
    );
    const surface = container.querySelector('[data-card-surface]')!;
    expect(surface.getAttribute('style') ?? '').toContain('--color-shell');
  });

  it('a block born remote keeps its accent regardless of session state', () => {
    const { container } = render(
      <BlockList {...baseProps} items={[cmdItem(makeBlock('r', 1_000, true))]} sessionRemoteSince={null} />,
    );
    const surface = container.querySelector('[data-card-surface]')!;
    expect(surface.getAttribute('style') ?? '').toContain('--color-agent');
  });
});
