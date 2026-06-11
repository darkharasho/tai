// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import '@testing-library/jest-dom';
import { render } from '@testing-library/react';
import { CommandBlock } from '../../src/components/CommandBlock';
import type { SegmentedBlock } from '../../src/types';

function makeBlock(extra: Partial<SegmentedBlock> = {}): SegmentedBlock {
  return {
    id: 'b1',
    command: 'false',
    output: 'out',
    rawOutput: 'out',
    promptText: 'me@host ~ $',
    startTime: 0,
    duration: 10,
    isRemote: false,
    ...extra,
  } as SegmentedBlock;
}

const noop = () => {};
const base = { onCopy: noop, onAskAI: noop, onRerun: noop };

describe('CommandBlock exit-code affordance', () => {
  it('shows a failure tag for a non-zero exit', () => {
    const { container } = render(<CommandBlock block={makeBlock({ exitCode: 2 })} {...base} />);
    const tag = container.querySelector('[class*="exitTag"]');
    expect(tag).toBeTruthy();
    expect(tag!.textContent).toContain('exit 2');
    expect(tag!.className).toContain('exitFailure');
  });

  it('shows a neutral interrupt tag for exit 130', () => {
    const { container } = render(<CommandBlock block={makeBlock({ exitCode: 130 })} {...base} />);
    const tag = container.querySelector('[class*="exitTag"]');
    expect(tag).toBeTruthy();
    expect(tag!.className).not.toContain('exitFailure');
  });

  it('shows no tag for success', () => {
    const { container } = render(<CommandBlock block={makeBlock({ exitCode: 0 })} {...base} />);
    expect(container.querySelector('[class*="exitTag"]')).toBeNull();
  });

  it('shows no tag while the command is active', () => {
    const { container } = render(
      <CommandBlock block={makeBlock({ exitCode: 2 })} active isActive {...base} />,
    );
    expect(container.querySelector('[class*="exitTag"]')).toBeNull();
  });

  it('shows the failure tag on collapsed cards too', () => {
    const { container } = render(
      <CommandBlock block={makeBlock({ exitCode: 1 })} collapsed {...base} />,
    );
    expect(container.querySelector('[class*="exitTag"]')).toBeTruthy();
  });
});
