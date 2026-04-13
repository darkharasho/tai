import { useState, useEffect, useCallback } from 'react';
import { TabBar } from './components/TabBar';
import { TerminalSession } from './components/TerminalSession';
import { SettingsOverlay } from './components/SettingsOverlay';
import WhatsNewModal from './components/WhatsNewModal';
import UpdateNotifier from './components/UpdateNotifier';
import ConfirmModal from './components/ConfirmModal';
import { useSettings } from './hooks/useSettings';
import { useWhatsNew } from './hooks/useWhatsNew';
import { useUpdateNotifier } from './hooks/useUpdateNotifier';
import type { ContextMode, TabState } from './types';

const SHELL_NAMES = new Set(['bash', 'zsh', 'sh', 'fish', 'dash', 'ksh', 'csh', 'tcsh', 'nu', 'pwsh', 'powershell', 'cmd']);

let tabCounter = 0;
function createTabState(): TabState {
  const id = `tab-${++tabCounter}`;
  return { id, ptyId: null, label: 'zsh', cwd: '', contextMode: 'shell', trustLevel: 'ask', isRemote: false, sshTarget: null };
}

export default function App() {
  const { config, setSetting } = useSettings();
  const whatsNew = useWhatsNew();
  const updater = useUpdateNotifier();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tabs, setTabs] = useState<TabState[]>(() => [createTabState()]);
  const [activeTabId, setActiveTabId] = useState(tabs[0].id);
  const [closeConfirm, setCloseConfirm] = useState<{ tabId: string; process: string } | null>(null);

  const activeTab = tabs.find(t => t.id === activeTabId)!;

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
    const tab = createTabState();
    setTabs(prev => [...prev, tab]);
    setActiveTabId(tab.id);
  }, []);

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
    setTabs(prev => prev.map(t => t.id === tabId ? { ...t, isRemote, sshTarget } : t));
  }, []);

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

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg-base)', overflow: 'hidden' }}>
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onSelectTab={setActiveTabId}
        onNewTab={handleNewTab}
        onCloseTab={requestCloseTab}
        onRenameTab={handleRenameTab}
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
            onContextModeChange={(mode) => handleContextModeChange(tab.id, mode)}
            onRemoteChange={(isRemote, sshTarget) => handleRemoteChange(tab.id, isRemote, sshTarget)}
          />
        </div>
      ))}
      <SettingsOverlay
        visible={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        config={config}
        onSet={setSetting}
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
