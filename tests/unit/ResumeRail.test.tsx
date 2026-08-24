// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom';
import { render, fireEvent } from '@testing-library/react';
import { BlockList, type DisplayItem } from '../../src/components/BlockList';
import { formatAgo } from '../../src/components/ResumeRail';
import type { SegmentedBlock } from '../../src/types';

vi.mock('../../src/components/InlineAIBlock', () => ({
  InlineAIBlock: () => <div />,
}));

function cmd(
  id: string,
  opts: { restored?: boolean; cwd?: string; exitCode?: number; duration?: number } = {},
): DisplayItem {
  return {
    type: 'command',
    restored: opts.restored,
    block: {
      id,
      command: `c-${id}`,
      output: 'out',
      rawOutput: 'out',
      promptText: 'p $',
      cwd: opts.cwd ?? '/home/u',
      startTime: 0,
      duration: opts.duration ?? 1000,
      exitCode: opts.exitCode ?? 0,
      isRemote: false,
    } as SegmentedBlock,
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

describe('formatAgo', () => {
  const now = 1_000_000_000_000;
  it('reads coarsely across the ranges', () => {
    expect(formatAgo(now - 5_000, now)).toBe('just now');
    expect(formatAgo(now - 5 * 60_000, now)).toBe('5m ago');
    expect(formatAgo(now - 2 * 3_600_000, now)).toBe('2h ago');
    expect(formatAgo(now - 24 * 3_600_000, now)).toBe('yesterday');
    expect(formatAgo(now - 5 * 24 * 3_600_000, now)).toBe('5d ago');
  });

  it('never reads as negative when the clock moved backwards', () => {
    expect(formatAgo(now + 60_000, now)).toBe('just now');
  });
});

describe('resume rail', () => {
  it('summarises restored blocks in one header', () => {
    const { getByRole } = render(
      <BlockList
        {...baseProps}
        restoredSavedAt={Date.now() - 2 * 3_600_000}
        items={[cmd('a', { restored: true }), cmd('b', { restored: true, exitCode: 1 })]}
      />,
    );
    const bar = getByRole('button', { expanded: true });
    expect(bar.textContent).toContain('2 commands');
    expect(bar.textContent).toContain('1 failed');
    expect(bar.textContent).toContain('2h ago');
  });

  it('is expanded by default and folds away on click', () => {
    const { container, getByRole } = render(
      <BlockList {...baseProps} items={[cmd('a', { restored: true })]} />,
    );
    expect(container.querySelectorAll('[data-collapsed]')).toHaveLength(1);
    fireEvent.click(getByRole('button', { expanded: true }));
    expect(container.querySelectorAll('[data-collapsed]')).toHaveLength(0);
  });

  it('holds only the restored run at the head of the list', () => {
    const { container } = render(
      <BlockList
        {...baseProps}
        items={[cmd('a', { restored: true }), cmd('live')]}
      />,
    );
    const rows = container.querySelector('[data-resume-rows]')!;
    expect(rows.textContent).toContain('c-a');
    expect(rows.textContent).not.toContain('c-live');
  });

  it('heads each run of blocks with its cwd, shortened to ~', () => {
    const { container } = render(
      <BlockList
        {...baseProps}
        items={[
          cmd('a', { restored: true, cwd: '/home/u' }),
          cmd('b', { restored: true, cwd: '/home/u' }),
          cmd('c', { restored: true, cwd: '/home/u/tai' }),
        ]}
      />,
    );
    const heads = [...container.querySelector('[data-resume-rows]')!.children]
      .map(el => el.textContent)
      .filter(t => t === '~' || t === '~/tai');
    expect(heads).toEqual(['~', '~/tai']);
  });

  it('renders no rail when nothing was restored', () => {
    const { container } = render(<BlockList {...baseProps} items={[cmd('live')]} />);
    expect(container.querySelector('[data-resume-rows]')).toBeNull();
  });
});

describe('welcome hero', () => {
  it('shows on first open even when history was restored', () => {
    const { getByText } = render(
      <BlockList {...baseProps} items={[cmd('a', { restored: true })]} />,
    );
    expect(getByText('run a command')).toBeInTheDocument();
  });

  it('goes away once something has run this session', () => {
    const { queryByText } = render(
      <BlockList {...baseProps} items={[cmd('a', { restored: true }), cmd('live')]} />,
    );
    expect(queryByText('run a command')).toBeNull();
  });

  it('runs each row action on click', () => {
    const onFocusComposer = vi.fn();
    const onStartAI = vi.fn();
    const onOpenPalette = vi.fn();
    const { getByText } = render(
      <BlockList
        {...baseProps}
        items={[]}
        onFocusComposer={onFocusComposer}
        onStartAI={onStartAI}
        onOpenPalette={onOpenPalette}
      />,
    );
    fireEvent.click(getByText('run a command'));
    fireEvent.click(getByText('ask the ai'));
    fireEvent.click(getByText('commands & history'));
    expect(onFocusComposer).toHaveBeenCalledOnce();
    expect(onStartAI).toHaveBeenCalledOnce();
    expect(onOpenPalette).toHaveBeenCalledOnce();
  });
});
