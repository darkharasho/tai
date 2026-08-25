// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import { CommandBlock } from '../../src/components/CommandBlock';
import type { SegmentedBlock } from '../../src/types';

function makeBlock(extra: Partial<SegmentedBlock> = {}): SegmentedBlock {
  return {
    id: 'b1',
    command: 'npm test',
    output: 'ok',
    rawOutput: 'ok',
    promptText: 'me@host ~ $',
    startTime: new Date(2024, 0, 2, 14, 32).getTime(),
    duration: 10,
    isRemote: false,
    exitCode: 0,
    ...extra,
  } as SegmentedBlock;
}

function setup(extra: Partial<SegmentedBlock> = {}, props: Record<string, unknown> = {}) {
  const onCopy = vi.fn();
  const onAskAI = vi.fn();
  const onRerun = vi.fn();
  const r = render(
    <CommandBlock block={makeBlock(extra)} onCopy={onCopy} onAskAI={onAskAI} onRerun={onRerun} {...props} />,
  );
  return { ...r, onCopy, onAskAI, onRerun };
}

describe('CommandBlock action row', () => {
  it('offers copy, copy-all and rerun on a finished block', () => {
    setup();
    expect(screen.getByRole('button', { name: /Copy cmd/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Copy all/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Rerun/ })).toBeInTheDocument();
  });

  it('copies just the command from Copy cmd', () => {
    const { onCopy } = setup();
    fireEvent.click(screen.getByRole('button', { name: /Copy cmd/ }));
    expect(onCopy).toHaveBeenCalledWith('npm test');
  });

  it('copies a pasteable transcript from Copy all', () => {
    const { onCopy } = setup({ output: 'boom', exitCode: 1 });
    fireEvent.click(screen.getByRole('button', { name: /Copy all/ }));
    const text = onCopy.mock.calls[0][0] as string;
    expect(text).toContain('$ npm test');
    expect(text).toContain('boom');
    expect(text).toContain('exit 1');
  });

  it('confirms the copy on the button that was pressed, not the other one', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: /Copy cmd/ }));
    expect(screen.getByRole('button', { name: /Copied/ })).toBeInTheDocument();
    // The sibling still offers its own action rather than both reading "Copied".
    expect(screen.getByRole('button', { name: /Copy all/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Copy cmd/ })).toBeNull();
  });

  it('reruns the command', () => {
    const { onRerun } = setup();
    fireEvent.click(screen.getByRole('button', { name: /Rerun/ }));
    expect(onRerun).toHaveBeenCalledWith('npm test');
  });

  it('names the AI action "Fix with AI" only when the command failed', () => {
    setup({ exitCode: 1 });
    expect(screen.getByRole('button', { name: /Fix with AI/ })).toBeInTheDocument();
  });

  it('falls back to a neutral "Ask AI" on a clean exit', () => {
    setup({ exitCode: 0 });
    expect(screen.queryByRole('button', { name: /Fix with AI/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Ask AI/ })).toBeInTheDocument();
  });

  it('tints only the failure variant, so the row has at most one coloured action', () => {
    const fail = setup({ exitCode: 1 });
    expect(screen.getByRole('button', { name: /Fix with AI/ }).className).toContain('actionBtnFix');
    fail.unmount();
    setup({ exitCode: 0 });
    expect(screen.getByRole('button', { name: /Ask AI/ }).className).not.toContain('actionBtnFix');
  });

  it('hands the whole block to the AI so it can see the output', () => {
    const { onAskAI } = setup({ exitCode: 1 });
    fireEvent.click(screen.getByRole('button', { name: /Fix with AI/ }));
    expect(onAskAI).toHaveBeenCalledWith(expect.objectContaining({ id: 'b1', output: 'ok' }));
  });

  it('shows a collapse control only when the parent can collapse', () => {
    const without = setup();
    expect(screen.queryByRole('button', { name: /Collapse/ })).toBeNull();
    without.unmount();
    const onToggleCollapse = vi.fn();
    setup({}, { onToggleCollapse });
    fireEvent.click(screen.getByRole('button', { name: /Collapse/ }));
    expect(onToggleCollapse).toHaveBeenCalled();
  });

  it('offers no block actions while the command is still running', () => {
    setup({}, { active: true, isActive: true });
    expect(screen.queryByRole('button', { name: /Rerun/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Copy cmd/ })).toBeNull();
  });
});

describe('CommandBlock wall-clock stamp', () => {
  it('stamps a finished block with the time it started', () => {
    const { container } = setup();
    expect(container.querySelector('[class*="clock"]')!.textContent).toBe('14:32');
  });

  it('carries the full date in a tooltip, since HH:MM alone is ambiguous', () => {
    const { container } = setup();
    expect(container.querySelector('[class*="clock"]')).toHaveAttribute('title');
  });

  it('omits the stamp while running, where the elapsed chip answers instead', () => {
    const { container } = setup({}, { active: true, isActive: true });
    expect(container.querySelector('[class*="clock"]')).toBeNull();
  });
});
