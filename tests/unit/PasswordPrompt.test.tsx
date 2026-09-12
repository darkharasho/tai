// @vitest-environment jsdom
// Characterisation of the terminal password prompt: keystrokes go to the PTY
// live. Written against the pre-extraction component so the PasswordField
// refactor cannot change terminal behaviour.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { PasswordPrompt } from '../../src/components/PasswordPrompt';

const write = vi.fn();
const rememberSecret = vi.fn();

beforeEach(() => {
  write.mockReset();
  rememberSecret.mockReset();
  (window as any).tai = { pty: { write, rememberSecret } };
});
afterEach(() => cleanup());

function setup() {
  const onDone = vi.fn();
  const { container } = render(<PasswordPrompt ptyId={7} onDone={onDone} />);
  return { onDone, el: container.firstChild as HTMLElement };
}

describe('PasswordPrompt (terminal)', () => {
  it('forwards chars and backspaces live, then newline on Enter', () => {
    const { onDone, el } = setup();
    fireEvent.keyDown(el, { key: 'Backspace' });
    fireEvent.keyDown(el, { key: 'a' });
    fireEvent.keyDown(el, { key: 'b' });
    fireEvent.keyDown(el, { key: 'Backspace' });
    fireEvent.keyDown(el, { key: 'Enter' });
    expect(write.mock.calls).toEqual([[7, 'a'], [7, 'b'], [7, '\x7f'], [7, '\n']]);
    expect(rememberSecret).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('remembers the secret when toggled', () => {
    const { el } = setup();
    fireEvent.click(document.body.querySelector('span[style*="cursor: pointer"]')!);
    fireEvent.keyDown(el, { key: 'x' });
    fireEvent.keyDown(el, { key: 'Enter' });
    expect(rememberSecret).toHaveBeenCalledWith('x');
  });

  it('Ctrl+C sends ETX; Escape does nothing', () => {
    const { onDone, el } = setup();
    fireEvent.keyDown(el, { key: 'Escape' });
    expect(write).not.toHaveBeenCalled();
    fireEvent.keyDown(el, { key: 'c', ctrlKey: true });
    expect(write.mock.calls).toEqual([[7, '\x03']]);
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
