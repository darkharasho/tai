// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import { AskUserQuestionView } from '../../src/components/AskUserQuestionView';

const wipe = {
  question: 'Confirm target: /dev/sda will be erased. Proceed?',
  header: 'Wipe /dev/sda',
  options: [
    { label: 'Yes, wipe /dev/sda', description: 'Erase the 231GB USB.' },
    { label: 'No, stop' },
  ],
  multiSelect: false,
};

describe('AskUserQuestionView', () => {
  it('renders the header, question and each option with its description', () => {
    render(<AskUserQuestionView questions={[wipe]} />);

    expect(screen.getByText('Wipe /dev/sda')).toBeInTheDocument();
    expect(screen.getByText('Confirm target: /dev/sda will be erased. Proceed?')).toBeInTheDocument();
    expect(screen.getByText('Yes, wipe /dev/sda')).toBeInTheDocument();
    expect(screen.getByText('Erase the 231GB USB.')).toBeInTheDocument();
    expect(screen.getByText('No, stop')).toBeInTheDocument();
    expect(screen.queryByText('select one or more')).not.toBeInTheDocument();
  });

  it('hints at multi-select and renders every question', () => {
    render(<AskUserQuestionView questions={[
      { question: 'Which targets?', options: [{ label: 'linux' }], multiSelect: true },
      { question: 'Sign the build?', options: [], multiSelect: false },
    ]} />);

    expect(screen.getByText('Which targets?')).toBeInTheDocument();
    expect(screen.getByText('Sign the build?')).toBeInTheDocument();
    expect(screen.getByText('select one or more')).toBeInTheDocument();
  });

  it('stays display-only without onSubmit', () => {
    render(<AskUserQuestionView questions={[wipe]} />);
    expect(screen.queryByRole('button', { name: /send answer/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /other/i })).not.toBeInTheDocument();
  });

  it('submits the clicked option keyed by question text', () => {
    const onSubmit = vi.fn();
    render(<AskUserQuestionView questions={[wipe]} onSubmit={onSubmit} />);

    const send = screen.getByRole('button', { name: /send answer/i });
    expect(send).toBeDisabled();

    fireEvent.click(screen.getByText('No, stop'));
    expect(send).toBeEnabled();
    fireEvent.click(send);

    expect(onSubmit).toHaveBeenCalledWith({
      'Confirm target: /dev/sda will be erased. Proceed?': 'No, stop',
    });
  });

  it('replaces the pick in single-select and accumulates in multi-select', () => {
    const onSubmit = vi.fn();
    render(<AskUserQuestionView
      questions={[{ question: 'Which targets?', options: [{ label: 'linux' }, { label: 'mac' }, { label: 'win' }], multiSelect: true }]}
      onSubmit={onSubmit}
    />);

    fireEvent.click(screen.getByText('linux'));
    fireEvent.click(screen.getByText('win'));
    fireEvent.click(screen.getByText('mac'));
    fireEvent.click(screen.getByText('mac'));   // toggles back off
    fireEvent.click(screen.getByRole('button', { name: /send answer/i }));

    expect(onSubmit).toHaveBeenCalledWith({ 'Which targets?': 'linux, win' });
  });

  it('replaces an earlier single-select pick rather than adding to it', () => {
    const onSubmit = vi.fn();
    render(<AskUserQuestionView questions={[wipe]} onSubmit={onSubmit} />);

    fireEvent.click(screen.getByText('Yes, wipe /dev/sda'));
    fireEvent.click(screen.getByText('No, stop'));
    fireEvent.click(screen.getByRole('button', { name: /send answer/i }));

    expect(onSubmit).toHaveBeenCalledWith({
      'Confirm target: /dev/sda will be erased. Proceed?': 'No, stop',
    });
  });

  it('sends free text from Other instead of the structured picks', () => {
    const onSubmit = vi.fn();
    render(<AskUserQuestionView questions={[wipe]} onSubmit={onSubmit} />);

    fireEvent.click(screen.getByText('Yes, wipe /dev/sda'));
    fireEvent.click(screen.getByRole('button', { name: /other/i }));
    fireEvent.change(screen.getByLabelText(/^Other answer for:/), { target: { value: 'wipe /dev/sdb instead' } });
    fireEvent.click(screen.getByRole('button', { name: /send answer/i }));

    expect(onSubmit).toHaveBeenCalledWith({
      'Confirm target: /dev/sda will be erased. Proceed?': 'wipe /dev/sdb instead',
    });
  });

  it('leaves Send disabled while the Other box is blank', () => {
    render(<AskUserQuestionView questions={[wipe]} onSubmit={vi.fn()} />);
    fireEvent.click(screen.getByText('No, stop'));
    fireEvent.click(screen.getByRole('button', { name: /other/i }));
    expect(screen.getByRole('button', { name: /send answer/i })).toBeDisabled();
  });

  it('offers Skip only while the question is answerable', () => {
    const onSkip = vi.fn();
    const { rerender } = render(<AskUserQuestionView questions={[wipe]} onSubmit={vi.fn()} onSkip={onSkip} />);
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(onSkip).toHaveBeenCalled();

    rerender(<AskUserQuestionView questions={[wipe]} answers={{ [wipe.question]: 'No, stop' }} />);
    expect(screen.queryByRole('button', { name: 'Skip' })).not.toBeInTheDocument();
  });

  it('marks the sent answer and drops the controls once resolved', () => {
    render(<AskUserQuestionView
      questions={[wipe]}
      answers={{ [wipe.question]: 'No, stop' }}
      onSubmit={vi.fn()}
    />);
    expect(screen.queryByRole('button', { name: /send answer/i })).not.toBeInTheDocument();
    expect(screen.getByText('No, stop').closest('div')?.className).toMatch(/optionChosen/);
  });

  it('shows a free-text answer that matches no option', () => {
    render(<AskUserQuestionView
      questions={[wipe]}
      answers={{ [wipe.question]: 'wipe /dev/sdb instead' }}
    />);
    expect(screen.getByText('wipe /dev/sdb instead')).toBeInTheDocument();
  });
});
