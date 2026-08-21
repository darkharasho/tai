// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom';
import { render, fireEvent, act } from '@testing-library/react';
import { TerminalInput } from '../../src/components/TerminalInput';
import { createIndex, ingestHistoryLines, type CommandIndex } from '../../src/utils/commandIndex';

const noop = () => {};

/** History containing a line that shares the typed prefix, so ghost text is
 *  always on offer while tabbing — the situation the old handler broke in. */
function indexWith(lines: string[]): CommandIndex {
  const index = createIndex();
  ingestHistoryLines(index, lines, Date.now());
  return index;
}

function renderInput(commandIndex: CommandIndex) {
  const view = render(
    <TerminalInput
      onSubmit={noop}
      mode="shell"
      onModeChange={noop}
      cwd="/home/user"
      commandIndex={commandIndex}
    />,
  );
  const textarea = view.container.querySelector('textarea')!;
  return { ...view, textarea };
}

/** Tab is handled through an async IPC round-trip; flush it. */
async function pressTab(textarea: HTMLTextAreaElement) {
  await act(async () => {
    fireEvent.keyDown(textarea, { key: 'Tab' });
    await Promise.resolve();
    await Promise.resolve();
  });
}

let tabComplete: ReturnType<typeof vi.fn>;

beforeEach(() => {
  tabComplete = vi.fn();
  (window as any).tai = { pty: { tabComplete }, shell: { pathBinaries: vi.fn().mockResolvedValue([]) } };
});

afterEach(() => {
  delete (window as any).tai;
  vi.restoreAllMocks();
});

describe('TerminalInput tab completion vs ghost text', () => {
  it('completes the path instead of accepting a history ghost that shares the prefix', async () => {
    // `cd Documents` is in history, so ghost text is offered for `cd Doc`.
    const { textarea } = renderInput(indexWith(['cd Documents', 'cd Documents/GitHub/tai']));
    fireEvent.change(textarea, { target: { value: 'cd Doc' } });

    tabComplete.mockResolvedValueOnce(['Documents/']);
    await pressTab(textarea);

    // The completion wins: a trailing slash, ready for the next level down.
    // Taking the ghost would have produced `cd Documents` with no slash.
    expect(textarea.value).toBe('cd Documents/');
  });

  it('keeps completing past the first directory', async () => {
    const { textarea } = renderInput(indexWith(['cd Documents', 'cd Documents/GitHub/tai']));
    fireEvent.change(textarea, { target: { value: 'cd Doc' } });

    tabComplete.mockResolvedValueOnce(['Documents/']);
    await pressTab(textarea);
    expect(textarea.value).toBe('cd Documents/');

    // Second Tab used to be swallowed by the ghost (or, when the ghost already
    // equalled the value, do nothing at all) and never reached the resolver.
    tabComplete.mockResolvedValueOnce(['Documents/GitHub/', 'Documents/Insta360/']);
    await pressTab(textarea);

    // The third argument is the pty id, which completion uses to resolve the
    // shell's live cwd; this bare render has no session behind it.
    expect(tabComplete).toHaveBeenLastCalledWith('cd Documents/', '/home/user', undefined);
    expect(textarea.value).toBe('cd Documents/GitHub/');
  });

  it('never leaves Tab a no-op when the ghost already equals the value', async () => {
    const { textarea } = renderInput(indexWith(['cd Documents']));
    fireEvent.change(textarea, { target: { value: 'cd Documents' } });

    tabComplete.mockResolvedValueOnce(['Documents/']);
    await pressTab(textarea);

    expect(tabComplete).toHaveBeenCalled();
    expect(textarea.value).toBe('cd Documents/');
  });

  it('leaves the line untouched when there is nothing to complete', async () => {
    // Ghost text offers `deploy --stage prod`, but Tab is not how you accept
    // it: a remembered line carries paths from wherever it was first run, and
    // pasting those into a directory that has no such entry is exactly the
    // "completes folders that do not exist here" complaint.
    const { textarea } = renderInput(indexWith(['deploy --stage prod']));
    fireEvent.change(textarea, { target: { value: 'deploy --st' } });

    tabComplete.mockResolvedValueOnce([]);
    await pressTab(textarea);

    expect(textarea.value).toBe('deploy --st');
  });

  it('accepts the ghost with ArrowRight instead', async () => {
    const { textarea } = renderInput(indexWith(['deploy --stage prod']));
    fireEvent.change(textarea, { target: { value: 'deploy --st' } });
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);

    fireEvent.keyDown(textarea, { key: 'ArrowRight' });

    expect(textarea.value).toBe('deploy --stage prod');
  });
});
