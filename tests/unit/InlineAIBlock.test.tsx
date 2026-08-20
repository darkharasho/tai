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
    fireEvent.click(container.querySelector('[data-ai-meta]')!);
    expect(container.querySelector('[data-ai-turn]')).not.toHaveAttribute('data-collapsed');
  });
});
