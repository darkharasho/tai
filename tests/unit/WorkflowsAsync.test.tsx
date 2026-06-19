// @vitest-environment jsdom
// Regression test: window.tai.workflows.get is async (returns Promise<Workflow[]>).
// SettingsOverlay must await it — if consumed synchronously the state would receive
// a Promise object instead of an array and the workflow name would never render.
import { describe, it, expect, vi, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { SettingsOverlay } from '@/components/SettingsOverlay';

const WORKFLOW = { id: 'wf-1', name: 'Deploy Prod', command: 'deploy {{env}}' };

afterEach(() => {
  cleanup();
});

function setupWindow() {
  Object.assign(window, {
    tai: {
      workflows: {
        get: vi.fn(() => Promise.resolve([WORKFLOW])),
        set: vi.fn(),
      },
    },
  });
}

describe('SettingsOverlay — async workflows.get', () => {
  it('renders workflow name after the promise resolves', async () => {
    setupWindow();
    render(
      <SettingsOverlay
        visible
        onClose={() => {}}
        config={{}}
        onSet={() => {}}
      />,
    );

    // Navigate to the Workflows tab so the useEffect fires.
    // The tab label appears in the sidebar; use getAllByText in case of duplicates.
    const tabs = screen.getAllByText('Workflows');
    fireEvent.click(tabs[tabs.length - 1]);

    // findByText waits for the DOM to update after the promise resolves.
    const name = await screen.findByText('Deploy Prod');
    expect(name).toBeTruthy();
    expect(window.tai.workflows.get).toHaveBeenCalled();
  });

  it('does NOT render a Promise object as workflow name (sync-consumption guard)', async () => {
    setupWindow();
    render(
      <SettingsOverlay
        visible
        onClose={() => {}}
        config={{}}
        onSet={() => {}}
      />,
    );

    const tabs = screen.getAllByText('Workflows');
    fireEvent.click(tabs[tabs.length - 1]);

    // Wait for the async update to settle.
    await screen.findByText('Deploy Prod');

    // If workflows.get had been consumed synchronously, the state would hold a
    // Promise and React would render "[object Promise]" somewhere in the DOM.
    expect(screen.queryByText(/\[object Promise\]/)).toBeNull();
  });
});
