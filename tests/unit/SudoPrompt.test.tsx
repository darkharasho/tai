// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { SudoPrompt } from '../../src/components/SudoPrompt';

const sudoAnswer = vi.fn();
const sudoCancel = vi.fn();

beforeEach(() => {
  sudoAnswer.mockReset();
  sudoCancel.mockReset();
  (window as any).tai = { ai: { sudoAnswer, sudoCancel } };
});
afterEach(() => cleanup());

describe('SudoPrompt', () => {
  it('shows the sudo prompt text', () => {
    render(<SudoPrompt requestId="req-1" prompt="[sudo] password for me:" />);
    expect(screen.getByText('[sudo] password for me:')).toBeInTheDocument();
  });

  it('sends the answer on Enter and nothing per keystroke', () => {
    render(<SudoPrompt requestId="req-1" prompt="p" />);
    const f = screen.getByTestId('password-field');
    fireEvent.keyDown(f, { key: 's' });
    fireEvent.keyDown(f, { key: 'k' });
    expect(sudoAnswer).not.toHaveBeenCalled();
    fireEvent.keyDown(f, { key: 'Enter' });
    expect(sudoAnswer).toHaveBeenCalledWith('req-1', 'sk', false);
  });

  it('Escape cancels', () => {
    render(<SudoPrompt requestId="req-1" prompt="p" />);
    fireEvent.keyDown(screen.getByTestId('password-field'), { key: 'Escape' });
    expect(sudoCancel).toHaveBeenCalledWith('req-1');
  });
});
