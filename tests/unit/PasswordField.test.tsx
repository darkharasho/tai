// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { PasswordField } from '../../src/components/PasswordField';

afterEach(() => cleanup());

function field() {
  return screen.getByTestId('password-field');
}

describe('PasswordField', () => {
  it('reports each char and submits the accumulated secret', () => {
    const onChar = vi.fn();
    const onSubmit = vi.fn();
    render(<PasswordField onChar={onChar} onSubmit={onSubmit} onCancel={() => {}} />);
    for (const k of ['a', 'b', 'c']) fireEvent.keyDown(field(), { key: k });
    fireEvent.keyDown(field(), { key: 'Backspace' });
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(onChar.mock.calls.map((c) => c[0])).toEqual(['a', 'b', 'c']);
    expect(onSubmit).toHaveBeenCalledWith('ab', false);
  });

  it('does not report backspace on an empty field', () => {
    const onBackspace = vi.fn();
    render(<PasswordField onBackspace={onBackspace} onSubmit={() => {}} onCancel={() => {}} />);
    fireEvent.keyDown(field(), { key: 'Backspace' });
    expect(onBackspace).not.toHaveBeenCalled();
  });

  it('passes the remember toggle through', () => {
    const onSubmit = vi.fn();
    render(<PasswordField onSubmit={onSubmit} onCancel={() => {}} />);
    fireEvent.click(screen.getByText('Remember for this session'));
    fireEvent.keyDown(field(), { key: 'x' });
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledWith('x', true);
  });

  it('Ctrl+C always cancels; Escape only when cancelOnEscape', () => {
    const onCancel = vi.fn();
    const { unmount } = render(<PasswordField onSubmit={() => {}} onCancel={onCancel} />);
    fireEvent.keyDown(field(), { key: 'Escape' });
    expect(onCancel).not.toHaveBeenCalled();
    fireEvent.keyDown(field(), { key: 'c', ctrlKey: true });
    expect(onCancel).toHaveBeenCalledTimes(1);
    unmount();
    render(<PasswordField cancelOnEscape onSubmit={() => {}} onCancel={onCancel} />);
    fireEvent.keyDown(field(), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it('never renders the secret', () => {
    render(<PasswordField onSubmit={() => {}} onCancel={() => {}} />);
    for (const k of 'hunter2') fireEvent.keyDown(field(), { key: k });
    expect(document.body.textContent).not.toContain('hunter2');
  });
});
