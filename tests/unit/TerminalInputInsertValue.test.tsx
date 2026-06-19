// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import '@testing-library/jest-dom';
import { render, act } from '@testing-library/react';
import { createRef } from 'react';
import { TerminalInput, type TerminalInputHandle } from '../../src/components/TerminalInput';
import type { CommandIndex } from '../../src/utils/commandIndex';

const noop = () => {};
const emptyIndex: CommandIndex = { commands: [], byName: {} };

function renderInput(ref: React.RefObject<TerminalInputHandle>) {
  return render(
    <TerminalInput
      ref={ref}
      onSubmit={noop}
      mode="shell"
      onModeChange={noop}
      cwd="/home/user"
      commandIndex={emptyIndex}
    />,
  );
}

describe('TerminalInput insertValue imperative handle', () => {
  it('exposes insertValue and sets the textarea value', () => {
    const ref = createRef<TerminalInputHandle>();
    renderInput(ref);
    act(() => { ref.current?.insertValue('git status'); });
    const textarea = document.querySelector('textarea')!;
    expect(textarea.value).toBe('git status');
  });

  it('re-inserting the SAME value a second time still updates the textarea (repeated identical pick)', () => {
    const ref = createRef<TerminalInputHandle>();
    renderInput(ref);

    // First insert
    act(() => { ref.current?.insertValue('git status'); });
    const textarea = document.querySelector('textarea')!;
    expect(textarea.value).toBe('git status');

    // Simulate user clearing the field between picks (mimics submit or manual clear)
    act(() => { ref.current?.insertValue(''); });
    expect(textarea.value).toBe('');

    // Second insert of the identical value — the old setEditValue(undefined)+setEditValue(same)
    // double-call approach would have been batched into a single React commit, leaving the
    // initialValue prop unchanged and the useEffect silent. insertValue() calls setValue()
    // directly inside the component so it always takes effect.
    act(() => { ref.current?.insertValue('git status'); });
    expect(textarea.value).toBe('git status');
  });

  it('does not auto-insert on mount (no initial value provided)', () => {
    const ref = createRef<TerminalInputHandle>();
    renderInput(ref);
    const textarea = document.querySelector('textarea')!;
    expect(textarea.value).toBe('');
  });
});
