import { useState, useEffect, useCallback, useRef } from 'react';
import { TabBar } from './components/TabBar';
import { TerminalSession } from './components/TerminalSession';
import { SettingsOverlay } from './components/SettingsOverlay';
import { QuickSettings } from './components/QuickSettings';
import WhatsNewModal from './components/WhatsNewModal';
import UpdateNotifier from './components/UpdateNotifier';
import ConfirmModal from './components/ConfirmModal';
import { useSettings } from './hooks/useSettings';
import { initScrollbarHover } from './utils/scrollbarHover';
import { useWhatsNew } from './hooks/useWhatsNew';
import { useUpdateNotifier } from './hooks/useUpdateNotifier';
import type { AIProvider, ContextMode, TabState, TrustLevel } from './types';

const SHELL_NAMES = new Set(['bash', 'zsh', 'sh', 'fish', 'dash', 'ksh', 'csh', 'tcsh', 'nu', 'pwsh', 'powershell', 'cmd']);

let tabCounter = 0;
function createTabState(defaults?: { trustLevel?: TrustLevel; aiProvider?: AIProvider }): TabState {
  const id = `tab-${++tabCounter}`;
  return { id, ptyId: null, label: 'zsh', cwd: '', contextMode: 'shell', trustLevel: defaults?.trustLevel || 'ask', isRemote: false, sshTarget: null, remoteExecMode: 'auto' as const, aiProvider: defaults?.aiProvider || 'claude' as const };
}

export default function App() {
  const { config, loaded: configLoaded, setSetting } = useSettings();
  const whatsNew = useWhatsNew();
  const updater = useUpdateNotifier();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [quickSettingsOpen, setQuickSettingsOpen] = useState(false);
  const persistedProvider = (config['ai.provider'] || 'claude') as AIProvider;
  const persistedTrust = (config['ai.trustLevel'] || 'ask') as TrustLevel;
  const [tabs, setTabs] = useState<TabState[]>(() => [createTabState()]);
  const [activeTabId, setActiveTabId] = useState(tabs[0].id);
  const [closeConfirm, setCloseConfirm] = useState<{ tabId: string; process: string } | null>(null);
  const configApplied = useRef(false);

  const [maximized, setMaximized] = useState(false);
  const activeTab = tabs.find(t => t.id === activeTabId)!;

  useEffect(() => {
    return window.tai?.window?.onMaximizedChange?.((m: boolean) => setMaximized(m));
  }, []);

  useEffect(() => initScrollbarHover(), []);

  useEffect(() => {
    if (!configLoaded || configApplied.current) return;
    configApplied.current = true;
    setTabs(prev => prev.map(t => ({
      ...t,
      aiProvider: persistedProvider,
      trustLevel: persistedTrust,
    })));
  }, [configLoaded, persistedProvider, persistedTrust]);

  useEffect(() => {
    if (!window.tai?.pty) return;
    for (const tab of tabs) {
      if (tab.ptyId === null) {
        window.tai.pty.create(tab.cwd).then(ptyId => {
          setTabs(prev => prev.map(t => t.id === tab.id ? { ...t, ptyId } : t));
        });
      }
    }
  }, [tabs.length]);

  const handleNewTab = useCallback(() => {
    const tab = createTabState({ trustLevel: persistedTrust, aiProvider: persistedProvider });
    setTabs(prev => [...prev, tab]);
    setActiveTabId(tab.id);
  }, [persistedTrust, persistedProvider]);

  const handleCloseTab = useCallback((id: string) => {
    const tab = tabs.find(t => t.id === id);
    if (tab?.ptyId != null) window.tai?.pty?.kill(tab.ptyId);
    setTabs(prev => {
      const next = prev.filter(t => t.id !== id);
      if (id === activeTabId && next.length > 0) {
        setActiveTabId(next[Math.max(0, prev.findIndex(t => t.id === id) - 1)].id);
      }
      return next;
    });
  }, [tabs, activeTabId]);

  const requestCloseTab = useCallback(async (id: string) => {
    if (tabs.length <= 1) return;
    const tab = tabs.find(t => t.id === id);
    if (tab?.ptyId != null) {
      const proc = await window.tai?.pty?.getProcess(tab.ptyId);
      if (proc && !SHELL_NAMES.has(proc)) {
        setCloseConfirm({ tabId: id, process: proc });
        return;
      }
    }
    handleCloseTab(id);
  }, [tabs, handleCloseTab]);

  const handleRenameTab = useCallback((id: string, label: string) => {
    setTabs(prev => prev.map(t => t.id === id ? { ...t, label } : t));
  }, []);

  const handleContextModeChange = useCallback((tabId: string, mode: ContextMode) => {
    setTabs(prev => prev.map(t => t.id === tabId ? { ...t, contextMode: mode } : t));
  }, []);

  const handleRemoteChange = useCallback((tabId: string, isRemote: boolean, sshTarget: string | null) => {
    setTabs(prev => prev.map(t => {
      if (t.id !== tabId) return t;
      const updates: Partial<TabState> = { isRemote, sshTarget };
      if (!isRemote) updates.remoteExecMode = 'auto';
      return { ...t, ...updates };
    }));
  }, []);

  const handleRemoteExecModeChange = useCallback((tabId: string, mode: 'auto' | 'local') => {
    setTabs(prev => prev.map(t => t.id === tabId ? { ...t, remoteExecMode: mode } : t));
  }, []);

  const handleTrustLevelChange = useCallback((level: TrustLevel) => {
    setTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, trustLevel: level } : t));
    setSetting('ai.trustLevel', level);
  }, [activeTabId, setSetting]);

  const handleAIProviderChange = useCallback((provider: AIProvider) => {
    setTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, aiProvider: provider } : t));
    setSetting('ai.provider', provider);
  }, [activeTabId, setSetting]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'T') { e.preventDefault(); handleNewTab(); }
      if (e.ctrlKey && e.key.toLowerCase() === 'w') { e.preventDefault(); requestCloseTab(activeTabId); }
      if (e.ctrlKey && !e.shiftKey && e.key >= '1' && e.key <= '9') {
        const idx = parseInt(e.key) - 1;
        if (idx < tabs.length) { e.preventDefault(); setActiveTabId(tabs[idx].id); }
      }
      if (e.ctrlKey && e.key === ',') { e.preventDefault(); setSettingsOpen(true); }
      if (e.ctrlKey && e.key === 'Tab') {
        e.preventDefault();
        const idx = tabs.findIndex(t => t.id === activeTabId);
        const next = e.shiftKey
          ? (idx - 1 + tabs.length) % tabs.length
          : (idx + 1) % tabs.length;
        setActiveTabId(tabs[next].id);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [tabs, activeTabId, handleNewTab, requestCloseTab]);

  const colorMode = config['appearance.colorMode'] || 'high';

  return (
    <div data-color-mode={colorMode} className={maximized ? undefined : 'window-frame'} style={{
      height: '100vh',
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--bg-base)',
      overflow: 'hidden',
      borderRadius: maximized ? 0 : 'var(--window-radius)',
    }}>
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onSelectTab={setActiveTabId}
        onNewTab={handleNewTab}
        onCloseTab={requestCloseTab}
        onRenameTab={handleRenameTab}
        onOpenQuickSettings={() => setQuickSettingsOpen(true)}
      />
      {tabs.map(tab => (
        <div
          key={tab.id}
          style={{
            flex: 1,
            minHeight: 0,
            display: tab.id === activeTabId ? 'flex' : 'none',
            flexDirection: 'column',
          }}
        >
          <TerminalSession
            tabId={tab.id}
            ptyId={tab.ptyId}
            cwd={tab.cwd}
            visible={tab.id === activeTabId}
            trustLevel={tab.trustLevel}
            aiProvider={tab.aiProvider}
            onContextModeChange={(mode) => handleContextModeChange(tab.id, mode)}
            onRemoteChange={(isRemote, sshTarget) => handleRemoteChange(tab.id, isRemote, sshTarget)}
            remoteExecMode={tab.remoteExecMode}
            onRemoteExecModeChange={(mode) => handleRemoteExecModeChange(tab.id, mode)}
            onTrustLevelChange={(level) => {
              setTabs(prev => prev.map(t => t.id === tab.id ? { ...t, trustLevel: level } : t));
            }}
          />
        </div>
      ))}
      <SettingsOverlay
        visible={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        config={config}
        onSet={setSetting}
      />
      <QuickSettings
        visible={quickSettingsOpen}
        onClose={() => setQuickSettingsOpen(false)}
        colorMode={colorMode}
        onColorModeChange={(mode) => setSetting('appearance.colorMode', mode)}
        trustLevel={activeTab.trustLevel}
        onTrustLevelChange={handleTrustLevelChange}
        aiProvider={activeTab.aiProvider}
        onAIProviderChange={handleAIProviderChange}
        claudeModel={config['claude.model'] || 'sonnet'}
        onClaudeModelChange={(model) => setSetting('claude.model', model)}
        claudeEffort={config['claude.effort'] || 'auto'}
        onClaudeEffortChange={(effort) => setSetting('claude.effort', effort)}
        expandToolCalls={!!config['ai.expandToolCalls']}
        onExpandToolCallsChange={(value) => setSetting('ai.expandToolCalls', value)}
      />
      <UpdateNotifier
        state={updater.state}
        dismissed={updater.dismissed}
        onInstall={updater.install}
        onDismiss={updater.dismiss}
      />
      <WhatsNewModal
        isOpen={whatsNew.isOpen}
        version={whatsNew.version}
        releases={whatsNew.releases}
        fetchStatus={whatsNew.fetchStatus}
        onClose={whatsNew.closeWhatsNew}
      />
      <ConfirmModal
        isOpen={closeConfirm !== null}
        title="Close tab?"
        message={`"${closeConfirm?.process}" is still running. Closing this tab will terminate it.`}
        confirmLabel="Close Tab"
        onConfirm={() => { if (closeConfirm) handleCloseTab(closeConfirm.tabId); setCloseConfirm(null); }}
        onCancel={() => setCloseConfirm(null)}
      />
    </div>
  );
}
