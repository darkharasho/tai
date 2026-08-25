// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom';
import { render, fireEvent, screen, waitFor } from '@testing-library/react';
import { TerminalInput } from '../../src/components/TerminalInput';
import { createIndex, ingestBlock, type CommandIndex } from '../../src/utils/commandIndex';

function indexWith(entries: Array<{ command: string; cwd?: string }>): CommandIndex {
  const idx = createIndex();
  // Ingest each entry several times so frecency ranking has something to prefer.
  for (const e of entries) ingestBlock(idx, { ...e, ts: Date.now() });
  return idx;
}

let statusMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  statusMock = vi.fn().mockResolvedValue({ branch: 'master', dirty: 2 });
  (window as any).tai = {
    shell: { pathBinaries: () => Promise.resolve([]) },
    git: { status: statusMock, branch: () => Promise.resolve('master') },
    pty: { tabComplete: () => Promise.resolve([]) },
  };
  localStorage.clear();
});

afterEach(() => { vi.restoreAllMocks(); });

function setup(overrides: Record<string, any> = {}) {
  const onModeChange = vi.fn();
  const props = {
    onSubmit: vi.fn(),
    mode: 'shell' as const,
    onModeChange,
    cwd: '/repo',
    commandIndex: createIndex(),
    ...overrides,
  };
  const utils = render(<TerminalInput {...props} />);
  return { ...utils, onModeChange, props };
}

describe('composer mode control', () => {
  it('offers both destinations, not just the current one', () => {
    setup();
    expect(screen.getByRole('button', { name: /Shell/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /AI/ })).toBeInTheDocument();
  });

  it('marks the active half pressed so the state is exposed, not just coloured', () => {
    setup({ mode: 'ai' });
    expect(screen.getByRole('button', { name: /AI/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Shell/ })).toHaveAttribute('aria-pressed', 'false');
  });

  it('switches mode when the inactive half is clicked', () => {
    const { onModeChange } = setup();
    fireEvent.click(screen.getByRole('button', { name: /AI/ }));
    expect(onModeChange).toHaveBeenCalledWith('ai');
  });

  it('does nothing when the already-active half is clicked', () => {
    const { onModeChange } = setup();
    fireEvent.click(screen.getByRole('button', { name: /Shell/ }));
    expect(onModeChange).not.toHaveBeenCalled();
  });

  it('teaches the classifier from a click exactly as Shift+Tab does', () => {
    // Clicking the toggle IS a correction, so it has to feed the classifier
    // the same way the keybinding does. Comparing the two rather than
    // asserting a specific stored value keeps this honest regardless of which
    // rung classified the input or whether that rung is learnable at all.
    const INPUT = 'deploy the staging build';

    const viaKey = setup();
    const keyField = document.querySelector('[data-composer]') as HTMLTextAreaElement;
    fireEvent.change(keyField, { target: { value: INPUT } });
    fireEvent.keyDown(keyField, { key: 'Tab', shiftKey: true });
    const afterKey = JSON.stringify({ ...localStorage });
    viaKey.unmount();
    localStorage.clear();

    const viaClick = setup();
    const clickField = document.querySelector('[data-composer]') as HTMLTextAreaElement;
    fireEvent.change(clickField, { target: { value: INPUT } });
    fireEvent.click(screen.getByRole('button', { name: /AI/ }));
    const afterClick = JSON.stringify({ ...localStorage });

    expect(viaClick.onModeChange).toHaveBeenCalledWith('ai');
    // Guard against the comparison passing because BOTH paths stored nothing.
    expect(afterClick).not.toBe('{}');
    expect(afterClick).toBe(afterKey);
  });
});

describe('branch chip', () => {
  it('shows branch and uncommitted count for a dirty tree', async () => {
    setup();
    expect(await screen.findByText('master +2')).toBeInTheDocument();
  });

  it('shows the bare branch when the tree is clean', async () => {
    statusMock.mockResolvedValue({ branch: 'main', dirty: 0 });
    setup();
    expect(await screen.findByText('main')).toBeInTheDocument();
  });

  it('renders no chip outside a repository', async () => {
    statusMock.mockResolvedValue({ branch: null, dirty: 0 });
    setup();
    await waitFor(() => expect(statusMock).toHaveBeenCalled());
    expect(screen.queryByText(/master/)).not.toBeInTheDocument();
  });

  it('does not describe a local repo while the prompt is remote', async () => {
    setup({ promptInfo: { text: 'me@remote ~ $', isRemote: true, sshTarget: 'me@remote' } });
    await waitFor(() => expect(statusMock).not.toHaveBeenCalled());
    expect(screen.queryByText('master +2')).not.toBeInTheDocument();
  });

  it('re-reads status after a command completes', async () => {
    const { rerender, props } = setup();
    await waitFor(() => expect(statusMock).toHaveBeenCalledTimes(1));
    rerender(<TerminalInput {...props} lastCommand="git commit" lastExitCode={0} />);
    await waitFor(() => expect(statusMock).toHaveBeenCalledTimes(2));
  });
});

describe('model chip', () => {
  it('names the model in AI mode', () => {
    setup({ mode: 'ai', model: 'sonnet' });
    expect(screen.getByText('sonnet')).toBeInTheDocument();
  });

  it('stays out of the way in shell mode, where no model is involved', () => {
    setup({ mode: 'shell', model: 'sonnet' });
    expect(screen.queryByText('sonnet')).not.toBeInTheDocument();
  });
});

describe('contextual hint row', () => {
  it('offers the mode switch when there is nothing to accept', () => {
    setup();
    expect(screen.getByText('Shift+Tab')).toBeInTheDocument();
    expect(screen.getByText(/switch to AI/)).toBeInTheDocument();
  });

  it('offers the accept key while a suggestion is showing', () => {
    setup({ commandIndex: indexWith([{ command: 'npm test', cwd: '/repo' }]) });
    const field = document.querySelector('[data-composer]') as HTMLTextAreaElement;
    fireEvent.change(field, { target: { value: 'npm t' } });
    expect(screen.getByText('accept')).toBeInTheDocument();
    expect(screen.queryByText('Shift+Tab')).not.toBeInTheDocument();
  });

  it('attributes the suggestion to this directory', () => {
    setup({ commandIndex: indexWith([{ command: 'npm test', cwd: '/repo' }]) });
    const field = document.querySelector('[data-composer]') as HTMLTextAreaElement;
    fireEvent.change(field, { target: { value: 'npm t' } });
    expect(screen.getByText(/from history · 1× here/)).toBeInTheDocument();
  });

  it('shows no provenance when nothing is being suggested', () => {
    setup();
    expect(screen.queryByText(/from history/)).not.toBeInTheDocument();
  });
});
