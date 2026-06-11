// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom';
import { render, fireEvent, screen } from '@testing-library/react';
import { CommandBlock } from '../../src/components/CommandBlock';
import type { SegmentedBlock } from '../../src/types';

function makeBlock(): SegmentedBlock {
  return {
    id: 'b1',
    command: 'rails server',
    output: 'Listening on http://127.0.0.1:3000',
    rawOutput: 'Listening on http://127.0.0.1:3000',
    promptText: 'me@host ~/app $',
    startTime: 0,
    duration: 0,
    isRemote: false,
  } as SegmentedBlock;
}

const noop = () => {};
const base = { onCopy: noop, onAskAI: noop, onRerun: noop };
let writeSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  writeSpy = vi.fn();
  (window as any).tai = { pty: { write: writeSpy } };
});

function setup(onAIPrompt = vi.fn()) {
  const utils = render(
    <CommandBlock block={makeBlock()} active isActive ptyId={1} docked sessionKind="server" onStop={noop} onAIPrompt={onAIPrompt} {...base} />,
  );
  const input = utils.container.querySelector('input[class*="cardInput"]') as HTMLInputElement;
  return { ...utils, input, onAIPrompt };
}

describe('session stdin AI detection', () => {
  it('routes natural-language questions to the side conversation, not the pty', () => {
    const { input, onAIPrompt } = setup();
    fireEvent.change(input, { target: { value: 'why is this request so slow?' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onAIPrompt).toHaveBeenCalledWith('why is this request so slow?');
    expect(writeSpy).not.toHaveBeenCalled();
    expect(input.value).toBe('');
  });

  it('still sends shell-ish input to the process stdin', () => {
    const { input, onAIPrompt } = setup();
    fireEvent.change(input, { target: { value: 'rs' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(writeSpy).toHaveBeenCalledWith(1, 'rs\n');
    expect(onAIPrompt).not.toHaveBeenCalled();
  });

  it('shows an AI badge while the input reads as natural language', () => {
    const { input, container } = setup();
    fireEvent.change(input, { target: { value: 'why is this request so slow?' } });
    expect(container.querySelector('[class*="cardInputAiBadge"]')).toBeTruthy();
    fireEvent.change(input, { target: { value: 'rs' } });
    expect(container.querySelector('[class*="cardInputAiBadge"]')).toBeNull();
  });

  it('turns the whole input purple while AI is detected', () => {
    const { input, container } = setup();
    fireEvent.change(input, { target: { value: 'why is this request so slow?' } });
    expect(container.querySelector('[class*="cardInputBoxAi"]')).toBeTruthy();
    fireEvent.change(input, { target: { value: 'rs' } });
    expect(container.querySelector('[class*="cardInputBoxAi"]')).toBeNull();
  });

  it('sends everything to the pty when no AI handler is provided', () => {
    const onAIPrompt = vi.fn();
    const utils = render(
      <CommandBlock block={makeBlock()} active isActive ptyId={1} docked sessionKind="server" onStop={noop} {...base} />,
    );
    const input = utils.container.querySelector('input[class*="cardInput"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'why is this request so slow?' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(writeSpy).toHaveBeenCalled();
    expect(onAIPrompt).not.toHaveBeenCalled();
  });
});
