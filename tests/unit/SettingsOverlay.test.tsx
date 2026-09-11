// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { SettingsOverlay } from '../../src/components/SettingsOverlay';

afterEach(() => {
  cleanup();
});

const baseProps = {
  visible: true,
  onClose: () => {},
  onSet: () => {},
  trustLevel: 'ask' as const, onTrustLevelChange: () => {},
  aiProvider: 'claude' as const, onAIProviderChange: () => {},
};

// Sidebar tabs are divs; setting labels are spans, so this can't hit a row.
function openTab(label: string) {
  fireEvent.click(screen.getByText(label, { selector: 'div' }));
}

describe('SettingsOverlay model selector', () => {
  it('shows the live availableModels label for the selected model', () => {
    render(
      <SettingsOverlay
        {...baseProps}
        config={{ 'claude.model': 'claude-fable-5' }}
        availableModels={[{ value: 'claude-fable-5', label: 'Fable 5' }]}
      />,
    );
    openTab('AI');
    expect(screen.getByText('Fable 5')).toBeInTheDocument();
  });

  it('falls back to the static lineup when availableModels is empty', () => {
    render(<SettingsOverlay {...baseProps} config={{ 'claude.model': 'opus' }} availableModels={[]} />);
    openTab('AI');
    // The refreshed static fallback label for `opus`.
    expect(screen.getByText('Opus 4.8')).toBeInTheDocument();
  });
});

describe('SettingsOverlay close setting', () => {
  // Close-to-tray predates the setting, so an unset value reads as tray.
  it('defaults to keeping the app in the tray', () => {
    render(<SettingsOverlay {...baseProps} config={{}} />);
    expect(screen.getByText('On Window Close')).toBeInTheDocument();
    expect(screen.getByText('Keep running in the tray')).toBeInTheDocument();
  });

  it('switches close to quit', () => {
    const changes: [string, unknown][] = [];
    render(<SettingsOverlay {...baseProps} config={{}} onSet={(k, v) => changes.push([k, v])} />);
    fireEvent.click(screen.getByText('Keep running in the tray'));
    fireEvent.click(screen.getByText('Quit'));
    expect(changes).toEqual([['general.closeAction', 'quit']]);
  });
});

// Provider and permissions have to reach the active tab, not just the saved
// default, so they must go through their handlers rather than onSet.
describe('SettingsOverlay per-tab AI settings', () => {
  it('routes a provider change through its handler', () => {
    const picked: string[] = [];
    const set: string[] = [];
    render(
      <SettingsOverlay {...baseProps} config={{}} onSet={k => set.push(k)}
        onAIProviderChange={p => picked.push(p)} />,
    );
    openTab('AI');
    fireEvent.click(screen.getByText('Claude', { selector: 'span' }));
    fireEvent.click(screen.getByText('Codex'));
    expect(picked).toEqual(['codex']);
    expect(set).toEqual([]);
  });
});
