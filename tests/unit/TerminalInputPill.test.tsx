// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import { RemoteAiPill } from '../../src/components/TerminalInput';

describe('RemoteAiPill', () => {
  it('renders nothing when hidden', () => {
    const { container } = render(
      <RemoteAiPill view={{ kind: 'hidden' }} onEnable={() => {}} onSetMode={() => {}} onDismiss={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the offer and fires onEnable', () => {
    const onEnable = vi.fn();
    render(<RemoteAiPill view={{ kind: 'offer', target: 'piclock' }} onEnable={onEnable} onSetMode={() => {}} onDismiss={() => {}} />);
    expect(screen.getByText(/piclock/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /enable/i }));
    expect(onEnable).toHaveBeenCalled();
  });

  it('renders the watch/run toggle and switches mode', () => {
    const onSetMode = vi.fn();
    render(<RemoteAiPill view={{ kind: 'active', target: 'piclock', mode: 'watch', error: null }} onEnable={() => {}} onSetMode={onSetMode} onDismiss={() => {}} />);
    expect(screen.getByRole('button', { name: /watch/i }).className).toMatch(/raiWatchOn|watchOn/i);
    fireEvent.click(screen.getByRole('button', { name: /run/i }));
    expect(onSetMode).toHaveBeenCalledWith('run');
  });

  it('shows an installing state', () => {
    render(<RemoteAiPill view={{ kind: 'installing', target: 'piclock' }} onEnable={() => {}} onSetMode={() => {}} onDismiss={() => {}} />);
    expect(screen.getByText(/installing/i)).toBeInTheDocument();
  });
});
