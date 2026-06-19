// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CommandPalette } from '@/components/CommandPalette';
import { PaletteItem } from '@/utils/palette';

const items: PaletteItem[] = [
  { id: '1', label: 'git status', value: 'git status', source: 'history' },
  { id: '2', label: 'Deploy', value: 'deploy {{env}}', source: 'workflow' },
];

describe('CommandPalette', () => {
  it('filters items by typed query and selects on Enter', () => {
    const onPick = vi.fn();
    render(<CommandPalette open items={items} onPick={onPick} onClose={() => {}} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'git' } });
    expect(screen.getByText('git status')).toBeTruthy();
    expect(screen.queryByText('Deploy')).toBeNull();
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ value: 'git status' }), false);
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(<CommandPalette open items={items} onPick={() => {}} onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
