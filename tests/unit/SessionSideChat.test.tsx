// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom';
import { render, fireEvent, screen } from '@testing-library/react';
import { SessionSideChat } from '../../src/components/SessionSideChat';
import type { DisplayItem } from '../../src/components/BlockList';

vi.mock('../../src/components/InlineAIBlock', () => ({
  InlineAIBlock: ({ question }: { question: string }) => <div data-testid="side-ai">{question}</div>,
}));

function ai(id: string, streaming = false): DisplayItem & { type: 'ai' } {
  return { type: 'ai', id, question: `q-${id}`, content: 'a', suggestedCommands: [], streaming };
}

function setup() {
  const onAsk = vi.fn();
  const onClose = vi.fn();
  render(
    <SessionSideChat items={[ai('1'), ai('2', true)]} onAsk={onAsk} onClose={onClose} onCopy={() => {}} onRunCommand={() => {}} />,
  );
  return { onAsk, onClose };
}

describe('SessionSideChat', () => {
  it('renders the conversation items', () => {
    setup();
    expect(screen.getAllByTestId('side-ai')).toHaveLength(2);
    expect(screen.getByText('q-1')).toBeInTheDocument();
  });

  it('sends follow-ups from its input', () => {
    const { onAsk } = setup();
    const input = screen.getByPlaceholderText(/ask about this session/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'and now?' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onAsk).toHaveBeenCalledWith('and now?');
    expect(input.value).toBe('');
  });

  it('closes from the header button', () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByTitle(/close/i));
    expect(onClose).toHaveBeenCalled();
  });
});
