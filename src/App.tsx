import { useState, useEffect, useRef, useCallback } from 'react';
import { XtermPane, XtermPaneHandle } from './components/XtermPane';
import { GradientBorder } from './components/GradientBorder';
import { TabBar } from './components/TabBar';
import type { ContextMode, TabState } from './types';

let tabCounter = 0;
function createTabState(): TabState {
  const id = `tab-${++tabCounter}`;
  return { id, ptyId: null, label: 'zsh', cwd: process.env.HOME || '/', contextMode: 'shell', trustLevel: 'ask' };
}

export default function App() {
  const [tabs, setTabs] = useState<TabState[]>(() => [createTabState()]);
  const [activeTabId, setActiveTabId] = useState(tabs[0].id);
  const xtermRefs = useRef<Map<string, XtermPaneHandle>>(new Map());

  const activeTab = tabs.find(t => t.id === activeTabId)!;

  useEffect(() => {
    for (const tab of tabs) {
      if (tab.ptyId === null) {
        window.tai.pty.create(tab.cwd).then(ptyId => {
          setTabs(prev => prev.map(t => t.id === tab.id ? { ...t, ptyId } : t));
        });
      }
    }
  }, [tabs.length]);

  useEffect(() => {
    setTimeout(() => xtermRefs.current.get(activeTabId)?.focus(), 50);
  }, [activeTabId]);

  const handleNewTab = useCallback(() => {
    const tab = createTabState();
    setTabs(prev => [...prev, tab]);
    setActiveTabId(tab.id);
  }, []);

  const handleCloseTab = useCallback((id: string) => {
    const tab = tabs.find(t => t.id === id);
    if (tab?.ptyId !== null && tab?.ptyId !== undefined) {
      window.tai.pty.kill(tab.ptyId);
    }
    setTabs(prev => {
      const next = prev.filter(t => t.id !== id);
      if (id === activeTabId && next.length > 0) {
        setActiveTabId(next[Math.max(0, prev.findIndex(t => t.id === id) - 1)].id);
      }
      return next;
    });
  }, [tabs, activeTabId]);

  const handleRenameTab = useCallback((id: string, label: string) => {
    setTabs(prev => prev.map(t => t.id === id ? { ...t, label } : t));
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'T') {
        e.preventDefault();
        handleNewTab();
      }
      if (e.ctrlKey && e.shiftKey && e.key === 'W') {
        e.preventDefault();
        if (tabs.length > 1) handleCloseTab(activeTabId);
      }
      if (e.ctrlKey && !e.shiftKey && e.key >= '1' && e.key <= '9') {
        const idx = parseInt(e.key) - 1;
        if (idx < tabs.length) {
          e.preventDefault();
          setActiveTabId(tabs[idx].id);
        }
      }
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
  }, [tabs, activeTabId, handleNewTab, handleCloseTab]);

  return (
    <GradientBorder mode={activeTab.contextMode}>
      <div style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-base)',
      }}>
        <TabBar
          tabs={tabs}
          activeTabId={activeTabId}
          onSelectTab={setActiveTabId}
          onNewTab={handleNewTab}
          onCloseTab={handleCloseTab}
          onRenameTab={handleRenameTab}
        />
        {tabs.map(tab => (
          <div
            key={tab.id}
            style={{
              flex: 1,
              display: tab.id === activeTabId ? 'flex' : 'none',
              flexDirection: 'column',
            }}
          >
            <XtermPane
              ref={el => {
                if (el) xtermRefs.current.set(tab.id, el);
                else xtermRefs.current.delete(tab.id);
              }}
              ptyId={tab.ptyId}
              visible={tab.id === activeTabId}
            />
          </div>
        ))}
      </div>
    </GradientBorder>
  );
}
