// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import { BlockOutline } from '@/components/BlockOutline';
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

describe('BlockOutline', () => {
  it('renders nothing for an empty session', () => {
    const { container } = render(
      <BlockOutline outline={buildOutline([])} currentId={null} onNavigate={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('counts blocks and failures in the header', () => {
    render(<BlockOutline outline={mixed} currentId={null} onNavigate={() => {}} />);
    expect(screen.getByText('3 blocks')).toBeTruthy();
    expect(screen.getByText('1 failed')).toBeTruthy();
  });

  it('omits the failure count when nothing failed', () => {
    render(<BlockOutline outline={buildOutline([cmd('a', 'ls')])} currentId={null} onNavigate={() => {}} />);
    expect(screen.getByText('1 block')).toBeTruthy();
    expect(screen.queryByText(/failed/)).toBeNull();
  });

  it('navigates to the block a row stands for', () => {
    const onNavigate = vi.fn();
    render(<BlockOutline outline={mixed} currentId={null} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByText('npm test'));
    expect(onNavigate).toHaveBeenCalledWith('b');
  });

  it('filters to failures and back', () => {
    render(<BlockOutline outline={mixed} currentId={null} onNavigate={() => {}} />);
    fireEvent.click(screen.getByText('1 failed'));
    expect(screen.queryByText('npm ci')).toBeNull();
    expect(screen.getByText('npm test')).toBeTruthy();
    fireEvent.click(screen.getByText('1 failed'));
    expect(screen.getByText('npm ci')).toBeTruthy();
  });

  it('caps a long session and reveals the rest on request', () => {
    const many = buildOutline(Array.from({ length: 46 }, (_, i) => cmd(`b${i}`, `cmd-${i}`)));
    render(<BlockOutline outline={many} currentId={null} onNavigate={() => {}} />);
    expect(screen.queryByText('cmd-0')).toBeNull();
    expect(screen.getByText('cmd-45')).toBeTruthy();
    fireEvent.click(screen.getByText('↑ 6 earlier'));
    expect(screen.getByText('cmd-0')).toBeTruthy();
  });
});
