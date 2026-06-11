// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom';
import { render, fireEvent, screen } from '@testing-library/react';
import { BlockFinder } from '../../src/components/BlockFinder';
import type { DisplayItem } from '../../src/components/BlockList';
import type { SegmentedBlock } from '../../src/types';

function cmd(id: string, command: string, output = ''): DisplayItem {
  return { type: 'command', block: { id, command, output, rawOutput: output, promptText: '', startTime: 0, duration: 0, isRemote: false } as SegmentedBlock };
}

const items: DisplayItem[] = [
  cmd('a', 'ls', 'gamma one'),
  cmd('b', 'pwd', 'two'),
  cmd('c', 'echo', 'gamma three'),
];

function setup() {
  const onClose = vi.fn();
  const onNavigate = vi.fn();
  render(<BlockFinder items={items} onClose={onClose} onNavigate={onNavigate} />);
  const input = screen.getByPlaceholderText(/find/i) as HTMLInputElement;
  return { input, onClose, onNavigate };
}

describe('BlockFinder', () => {
  it('shows the match count and navigates to the first match as you type', () => {
    const { input, onNavigate } = setup();
    fireEvent.change(input, { target: { value: 'gamma' } });
    expect(screen.getByText('1/2')).toBeInTheDocument();
    expect(onNavigate).toHaveBeenLastCalledWith('a');
  });

  it('advances with Enter and wraps around', () => {
    const { input, onNavigate } = setup();
    fireEvent.change(input, { target: { value: 'gamma' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onNavigate).toHaveBeenLastCalledWith('c');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onNavigate).toHaveBeenLastCalledWith('a');
  });

  it('goes back with Shift+Enter', () => {
    const { input, onNavigate } = setup();
    fireEvent.change(input, { target: { value: 'gamma' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(onNavigate).toHaveBeenLastCalledWith('c');
  });

  it('shows 0/0 when nothing matches', () => {
    const { input } = setup();
    fireEvent.change(input, { target: { value: 'zzz' } });
    expect(screen.getByText('0/0')).toBeInTheDocument();
  });

  it('closes on Escape', () => {
    const { input, onClose } = setup();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
