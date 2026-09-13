// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { SudoCacheBadge } from '../../src/components/SudoCacheBadge';

afterEach(() => cleanup());

describe('SudoCacheBadge', () => {
  it('sits in the bottom corner over the composer', () => {
    render(<SudoCacheBadge cached flash={false} onForget={() => {}} />);
    expect(screen.getByRole('button')).toHaveStyle({ bottom: '10px' });
  });

  it('stays off live terminal text unless flashing', () => {
    render(<SudoCacheBadge cached flash={false} overTerminal onForget={() => {}} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('flashes in the top corner while the terminal owns the pane', () => {
    render(<SudoCacheBadge cached flash overTerminal onForget={() => {}} />);
    const btn = screen.getByRole('button');
    expect(btn).toHaveStyle({ top: '8px' });
    expect(btn.style.bottom).toBe('');
  });
});
