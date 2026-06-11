// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom';
import { render, fireEvent, screen } from '@testing-library/react';
import { CommandBlock } from '../../src/components/CommandBlock';
import type { SegmentedBlock } from '../../src/types';

function makeBlock(): SegmentedBlock {
  return {
    id: 'b1',
    command: 'ls -la',
    output: 'file1\nfile2',
    rawOutput: 'file1\nfile2',
    promptText: 'me@host ~ $',
    startTime: 0,
    duration: 10,
    exitCode: 0,
    isRemote: false,
  } as SegmentedBlock;
}

function setup(extra: Partial<Parameters<typeof CommandBlock>[0]> = {}) {
  const onCopy = vi.fn();
  const onRerun = vi.fn();
  const onAskAI = vi.fn();
  const utils = render(
    <CommandBlock block={makeBlock()} onCopy={onCopy} onRerun={onRerun} onAskAI={onAskAI} {...extra} />,
  );
  const card = utils.container.querySelector('[data-card-surface], [class*="collapsed"]') as HTMLElement;
  return { ...utils, onCopy, onRerun, onAskAI, card };
}

describe('CommandBlock context menu', () => {
  it('opens on right-click with the Warp block action set', () => {
    const { card } = setup();
    fireEvent.contextMenu(card);
    expect(screen.getByText('Copy command')).toBeInTheDocument();
    expect(screen.getByText('Copy output')).toBeInTheDocument();
    expect(screen.getByText('Copy command + output')).toBeInTheDocument();
    expect(screen.getByText('Re-run command')).toBeInTheDocument();
    expect(screen.getByText('Ask AI about this')).toBeInTheDocument();
  });

  it('copies the output text', () => {
    const { card, onCopy } = setup();
    fireEvent.contextMenu(card);
    fireEvent.click(screen.getByText('Copy output'));
    expect(onCopy).toHaveBeenCalledWith('file1\nfile2');
  });

  it('copies command and output together', () => {
    const { card, onCopy } = setup();
    fireEvent.contextMenu(card);
    fireEvent.click(screen.getByText('Copy command + output'));
    expect(onCopy).toHaveBeenCalledWith('ls -la\nfile1\nfile2');
  });

  it('re-runs the command and closes the menu', () => {
    const { card, onRerun } = setup();
    fireEvent.contextMenu(card);
    fireEvent.click(screen.getByText('Re-run command'));
    expect(onRerun).toHaveBeenCalledWith('ls -la');
    expect(screen.queryByText('Copy command')).toBeNull();
  });

  it('asks AI with the block', () => {
    const { card, onAskAI } = setup();
    fireEvent.contextMenu(card);
    fireEvent.click(screen.getByText('Ask AI about this'));
    expect(onAskAI).toHaveBeenCalledWith(expect.objectContaining({ id: 'b1' }));
  });

  it('closes on Escape', () => {
    const { card } = setup();
    fireEvent.contextMenu(card);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByText('Copy command')).toBeNull();
  });

  it('opens on collapsed cards too', () => {
    const { card } = setup({ collapsed: true });
    fireEvent.contextMenu(card);
    expect(screen.getByText('Copy command')).toBeInTheDocument();
  });
});
