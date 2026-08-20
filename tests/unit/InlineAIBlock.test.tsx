// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import '@testing-library/jest-dom';
import { render, fireEvent } from '@testing-library/react';
import { InlineAIBlock } from '../../src/components/InlineAIBlock';

const baseProps = {
  question: 'why is the sky blue?',
  content: '',
  onRunCommand: () => {},
};

function renderTurn(extra: Record<string, unknown> = {}) {
  return render(
    <InlineAIBlock
      {...baseProps}
      entries={[{ kind: 'text', text: 'Rayleigh scattering.\nThe short version.' }]}
      duration={4300}
      {...extra}
    />,
  );
}

describe('InlineAIBlock resting state', () => {
  it('renders the answer expanded by default', () => {
    const { container } = renderTurn();
    const turn = container.querySelector('[data-ai-turn]')!;
    expect(turn).toBeInTheDocument();
    expect(turn).not.toHaveAttribute('data-collapsed');
    expect(turn).toHaveTextContent('Rayleigh scattering.');
  });

  it('folds to a single row carrying a summary when the meta line is clicked', () => {
    const { container } = renderTurn();
    fireEvent.click(container.querySelector('[data-ai-meta]')!);

    const turn = container.querySelector('[data-ai-turn]')!;
    expect(turn).toHaveAttribute('data-collapsed', 'true');
    // The answer body is gone; its first line stands in for it.
    expect(turn.textContent).toContain('Rayleigh scattering.');
    expect(turn.textContent).not.toContain('The short version.');
    // The header row survives the fold: the question still heads the turn,
    // and the provider mark (named by its tooltip) and duration ride with it.
    expect(turn.textContent).toContain('why is the sky blue?');
    expect(turn.querySelector('[title="Claude"]')).toBeInTheDocument();
    expect(turn.textContent).toContain('4.3s');
  });

  it('unfolds again on a second click', () => {
    const { container } = renderTurn();
    const header = container.querySelector('[data-ai-meta]')!;
    fireEvent.click(header);
    fireEvent.click(container.querySelector('[data-ai-meta]')!);
    expect(container.querySelector('[data-ai-turn]')).not.toHaveAttribute('data-collapsed');
  });

  it('offers no fold while the answer is still streaming', () => {
    const { container } = renderTurn({ streaming: true, duration: undefined });
    const turn = container.querySelector('[data-ai-turn]')!;
    expect(turn).toHaveAttribute('data-streaming', 'true');
    // There is nothing to fold to yet, so the control is not rendered at all.
    expect(container.querySelector('[data-ai-meta]')).toBeNull();
    expect(turn).not.toHaveAttribute('data-collapsed');
  });

  it('marks the question as the user\'s line and puts the answer after it', () => {
    const { container } = renderTurn();
    const turn = container.querySelector('[data-ai-turn]')!;
    // The caret leads the question; the answer follows as its own block.
    expect(turn.textContent).toContain('\u276Fwhy is the sky blue?');
    expect(turn.textContent).toContain('Rayleigh scattering.');
  });

  it('still renders a long question, as markdown', () => {
    const long = 'why is it '.repeat(30);
    const { container } = renderTurn({ question: long });
    const turn = container.querySelector('[data-ai-turn]')!;
    expect(turn.textContent).toContain('why is it why is it');
    expect(turn.querySelector('p')).toBeInTheDocument();
  });
});

describe('InlineAIBlock turn layout', () => {
  it('leads with the question even when the answer opens with a tool call', () => {
    const { container } = render(
      <InlineAIBlock
        {...baseProps}
        entries={[
          { kind: 'tool', call: { id: 't1', name: 'Bash', input: '{"command":"ls"}', output: 'a\nb' } },
          { kind: 'text', text: 'Two files.' },
        ]}
        duration={1200}
      />,
    );
    const turn = container.querySelector('[data-ai-turn]')!;
    expect(turn.textContent).toContain('\u276Fwhy is the sky blue?');
    expect(turn.textContent).toContain('Two files.');
  });

  it('shows the question line from the first frame of a streaming answer', () => {
    const { container } = render(
      <InlineAIBlock {...baseProps} entries={[]} streaming content="" />,
    );
    expect(container.querySelector('[data-ai-turn]')!.textContent).toContain('\u276Fwhy is the sky blue?');
  });
});
