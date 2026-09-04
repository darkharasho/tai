// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import { OutlineFlyout } from '@/components/OutlineFlyout';
import { buildOutline } from '@/utils/sessionOutline';
import type { DisplayItem } from '@/components/BlockList';
import type { SegmentedBlock } from '@/types';

function cmd(id: string, command: string, exitCode = 0): DisplayItem {
  return {
    type: 'command',
    block: {
      id, command, output: '', rawOutput: '', promptText: '',
      startTime: 0, duration: 0, isRemote: false, exitCode,
    } as SegmentedBlock,
  };
}

const mixed = buildOutline([
  cmd('a', 'npm ci'),
  cmd('b', 'npm test', 1),
  cmd('c', 'git status'),
]);

function show(outline = mixed, currentId: string | null = null, onNavigate = () => {}) {
  return render(
    <OutlineFlyout
      outline={outline}
      currentId={currentId}
      anchorTop={0}
      onNavigate={onNavigate}
      onClose={() => {}}
    />,
  );
}

describe('OutlineFlyout', () => {
  it('counts blocks and failures in the header', () => {
    show();
    expect(screen.getByText('3 blocks')).toBeTruthy();
    expect(screen.getByText('1 failed')).toBeTruthy();
  });

  it('omits the failure count when nothing failed', () => {
    show(buildOutline([cmd('a', 'ls')]));
    expect(screen.getByText('1 block')).toBeTruthy();
    expect(screen.queryByText(/failed/)).toBeNull();
  });

  it('navigates to the block a row stands for', () => {
    const onNavigate = vi.fn();
    show(mixed, null, onNavigate);
    fireEvent.click(screen.getByText('npm test'));
    expect(onNavigate).toHaveBeenCalledWith('b');
  });

  it('filters to failures and back', () => {
    show();
    fireEvent.click(screen.getByText('1 failed'));
    expect(screen.queryByText('npm ci')).toBeNull();
    expect(screen.getByText('npm test')).toBeTruthy();
    fireEvent.click(screen.getByText('1 failed'));
    expect(screen.getByText('npm ci')).toBeTruthy();
  });

  // The old inline outline capped itself at 40 rows and offered the rest
  // behind an "earlier" button. Typing replaces that: nothing is hidden, so
  // reaching an old block is a query rather than a scroll.
  it('reaches any block in a long session by filtering', () => {
    const many = buildOutline(Array.from({ length: 400 }, (_, i) => cmd(`b${i}`, `cmd-${i}`)));
    show(many);
    expect(screen.getByText('400 blocks')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('Filter blocks…'), { target: { value: 'cmd-7 ' } });
    expect(screen.queryByText('cmd-399')).toBeNull();
    fireEvent.change(screen.getByPlaceholderText('Filter blocks…'), { target: { value: 'cmd-7' } });
    expect(screen.getByText('cmd-7')).toBeTruthy();
  });

  it('reports when a filter matches nothing', () => {
    show();
    fireEvent.change(screen.getByPlaceholderText('Filter blocks…'), { target: { value: 'zzz' } });
    expect(screen.getByText('No matching blocks')).toBeTruthy();
    expect(screen.queryByText('npm ci')).toBeNull();
  });

  it('jumps to the keyboard selection on Enter', () => {
    const onNavigate = vi.fn();
    show(mixed, 'b', onNavigate);
    const panel = screen.getByRole('dialog');
    fireEvent.keyDown(panel, { key: 'ArrowUp' });
    fireEvent.keyDown(panel, { key: 'Enter' });
    expect(onNavigate).toHaveBeenCalledWith('a');
  });

  it('opens on the block currently in the viewport', () => {
    const onNavigate = vi.fn();
    show(mixed, 'b', onNavigate);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Enter' });
    expect(onNavigate).toHaveBeenCalledWith('b');
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(
      <OutlineFlyout outline={mixed} currentId={null} anchorTop={0} onNavigate={() => {}} onClose={onClose} />,
    );
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
