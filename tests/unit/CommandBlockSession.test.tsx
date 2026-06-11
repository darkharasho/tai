// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom';
import { render, fireEvent, screen } from '@testing-library/react';
import { CommandBlock } from '../../src/components/CommandBlock';
import type { SegmentedBlock } from '../../src/types';

function makeBlock(extra: Partial<SegmentedBlock> = {}): SegmentedBlock {
  return {
    id: 'b1',
    command: 'rails server',
    output: '* Listening on http://127.0.0.1:3000',
    rawOutput: '* Listening on http://127.0.0.1:3000',
    promptText: 'me@host ~/app $',
    startTime: Date.now() - 5000,
    duration: 0,
    isRemote: false,
    ...extra,
  } as SegmentedBlock;
}

const noop = () => {};
const base = { onCopy: noop, onAskAI: noop, onRerun: noop };

describe('CommandBlock session header', () => {
  it('renders the session header for an active server session', () => {
    const { container } = render(
      <CommandBlock block={makeBlock()} active isActive ptyId={1} sessionKind="server" port={3000} onStop={noop} onRestart={noop} {...base} />,
    );
    expect(container.querySelector('[class*="sessionHead"]')).toBeTruthy();
    expect(screen.getByText('rails server')).toBeInTheDocument();
    expect(screen.getByText('server')).toBeInTheDocument();
    expect(screen.getByText(/localhost:3000/)).toBeInTheDocument();
    expect(screen.getByText('STOP')).toBeInTheDocument();
    expect(screen.getByText('RESTART')).toBeInTheDocument();
  });

  it('autofocuses the rooted stdin line so the morph lands ready to type', () => {
    render(
      <CommandBlock block={makeBlock()} active isActive ptyId={1} sessionKind="server" onStop={noop} {...base} />,
    );
    expect((document.activeElement as HTMLElement)?.className).toContain('cardInput');
  });

  it('wires STOP and RESTART', () => {
    const onStop = vi.fn();
    const onRestart = vi.fn();
    render(
      <CommandBlock block={makeBlock()} active isActive ptyId={1} sessionKind="server" onStop={onStop} onRestart={onRestart} {...base} />,
    );
    fireEvent.click(screen.getByText('STOP'));
    fireEvent.click(screen.getByText('RESTART'));
    expect(onStop).toHaveBeenCalled();
    expect(onRestart).toHaveBeenCalled();
  });

  it('shows an agent session header without RESTART and with END', () => {
    render(
      <CommandBlock block={makeBlock({ command: 'claude' })} active isActive ptyId={1} sessionKind="agent" onStop={noop} {...base} />,
    );
    expect(screen.getByText('agent session')).toBeInTheDocument();
    expect(screen.queryByText('RESTART')).toBeNull();
    expect(screen.getByText('END')).toBeInTheDocument();
  });

  it('keeps the normal prompt header when there is no session kind', () => {
    const { container } = render(<CommandBlock block={makeBlock()} active isActive ptyId={1} {...base} />);
    expect(container.querySelector('[class*="sessionHead"]')).toBeNull();
  });

  it('keeps the normal prompt header once the session has finished (inactive)', () => {
    const { container } = render(<CommandBlock block={makeBlock()} sessionKind="server" {...base} />);
    expect(container.querySelector('[class*="sessionHead"]')).toBeNull();
  });

  it('shows the summary line on collapsed cards', () => {
    const { container } = render(
      <CommandBlock block={makeBlock({ summaryLine: ':3000 · 214 lines' })} collapsed {...base} />,
    );
    expect(container.textContent).toContain(':3000 · 214 lines');
  });
});
