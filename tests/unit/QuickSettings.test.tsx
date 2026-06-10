// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import { QuickSettings } from '../../src/components/QuickSettings';

// Minimal required props; only the model wiring matters here.
const baseProps = {
  visible: true,
  onClose: () => {},
  colorMode: 'high', onColorModeChange: () => {},
  cardAccent: 'brackets', onCardAccentChange: () => {},
  noise: true, onNoiseChange: () => {},
  trustLevel: 'ask' as const, onTrustLevelChange: () => {},
  aiProvider: 'claude' as const, onAIProviderChange: () => {},
  claudeEffort: 'auto', onClaudeEffortChange: () => {},
  expandToolCalls: false, onExpandToolCallsChange: () => {},
  systemNotifications: false, onSystemNotificationsChange: () => {},
};

function openClaudeTab() {
  // "Claude" appears both as the provider dropdown value and the sidebar tab;
  // the sidebar "Claude" tab is the sibling immediately after the "General" tab.
  const general = screen.getByText('General');
  const claudeTab = general.nextElementSibling as HTMLElement;
  fireEvent.click(claudeTab);
}

describe('QuickSettings model selector', () => {
  it('shows the live availableModels label for the selected model', () => {
    render(
      <QuickSettings
        {...baseProps}
        claudeModel="claude-fable-5"
        onClaudeModelChange={() => {}}
        availableModels={[{ value: 'claude-fable-5', label: 'Fable 5' }]}
      />,
    );
    openClaudeTab();
    expect(screen.getByText('Fable 5')).toBeInTheDocument();
  });

  it('falls back to the static lineup when availableModels is empty', () => {
    render(
      <QuickSettings
        {...baseProps}
        claudeModel="opus"
        onClaudeModelChange={() => {}}
        availableModels={[]}
      />,
    );
    openClaudeTab();
    // The refreshed static fallback label for `opus`.
    expect(screen.getByText('Opus 4.8')).toBeInTheDocument();
  });
});
