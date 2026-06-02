// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { CommandBlock } from '../../src/components/CommandBlock';
import type { SegmentedBlock } from '../../src/types';

const block: SegmentedBlock = {
  id: 'b1',
  command: 'python',
  output: '',
  rawOutput: '',
  promptText: 'me@host ~/proj $',
  startTime: 0,
  duration: 0,
  exitCode: undefined,
  isRemote: false,
} as SegmentedBlock;

const noop = () => {};

describe('CommandBlock docked variant', () => {
  it('applies the docked interactive body class when docked', () => {
    const { container } = render(
      <CommandBlock
        block={block}
        active
        isActive
        bodyMode="interactive"
        ptyId={7}
        docked
        onCopy={noop}
        onAskAI={noop}
        onRerun={noop}
      />,
    );
    expect(container.querySelector('[class*="dockedInteractiveBody"]')).toBeTruthy();
  });

  it('renders a headerExtra slot (e.g. the remote-AI pill) in the header', () => {
    render(
      <CommandBlock
        block={block}
        active
        isActive
        bodyMode="interactive"
        ptyId={7}
        docked
        headerExtra={<span data-testid="pill">pill</span>}
        onCopy={noop}
        onAskAI={noop}
        onRerun={noop}
      />,
    );
    expect(screen.getByTestId('pill')).toBeInTheDocument();
  });
});
