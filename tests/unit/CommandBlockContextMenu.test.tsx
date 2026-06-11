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

  it('clamps the menu inside the viewport near the bottom edge', () => {
    const origRect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function () {
      if ((this as HTMLElement).className?.includes?.('contextMenu')) {
        return { width: 200, height: 180, top: 0, left: 0, right: 200, bottom: 180, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
      }
      return origRect.call(this);
    };
    try {
      const { card } = setup();
      fireEvent.contextMenu(card, { clientX: 100, clientY: window.innerHeight - 10 });
      const menu = screen.getByText('Copy command').closest('[class*="contextMenu"]') as HTMLElement;
      expect(parseInt(menu.style.top)).toBeLessThanOrEqual(window.innerHeight - 180 - 8);
      expect(menu.style.left).toBe('100px');
    } finally {
      Element.prototype.getBoundingClientRect = origRect;
    }
  });

  it('portals the menu to document.body so card containment cannot offset it', () => {
    // content-visibility on the card wrapper creates a containing block for
    // position:fixed descendants; the menu must escape the card subtree or
    // viewport coordinates land relative to the card.
    const { card, container } = setup();
    fireEvent.contextMenu(card, { clientX: 40, clientY: 50 });
    const menu = screen.getByText('Copy command').closest('[class*="contextMenu"]') as HTMLElement;
    expect(container.contains(menu)).toBe(false);
    expect(menu.parentElement).toBe(document.body);
    expect(menu.style.left).toBe('40px');
    expect(menu.style.top).toBe('50px');
  });
});
