import { useState, useSyncExternalStore } from 'react';
import { Plus, X } from 'lucide-react';
import type { TabState, ContextMode } from '@/types';
import { TrustBadge } from './TrustBadge';
import { BlockOutline } from './BlockOutline';
import { getOutline, getOutlineVersion, subscribeOutlines } from '@/stores/outlineStore';
import styles from './TabSidebar.module.css';

const MODE_COLORS: Record<ContextMode, string> = {
  shell: 'var(--color-shell)',
  ai: 'var(--color-ai)',
  agent: 'var(--color-agent)',
  error: 'var(--color-error)',
};

interface TabSidebarProps {
  tabs: TabState[];
  activeTabId: string;
  onSelectTab: (id: string) => void;
  onNewTab: () => void;
  onCloseTab: (id: string) => void;
  onRenameTab: (id: string, label: string) => void;
}

/** `~/Documents/GitHub/tai` → `tai`; the leaf is all the row has room for. */
function leaf(cwd: string): string {
  if (!cwd) return '';
  const parts = cwd.replace(/\/+$/, '').split('/');
  return parts[parts.length - 1] || '/';
}

/**
 * Warp's tab rail. Vertical, so tabs no longer compete for horizontal space:
 * the list simply scrolls, which is why the old bar's width measuring and
 * overflow dropdown have no counterpart here.
 */
export function TabSidebar({ tabs, activeTabId, onSelectTab, onNewTab, onCloseTab, onRenameTab }: TabSidebarProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  // Subscribing to the outline store here (rather than holding outlines in
  // App) keeps block churn from re-rendering every mounted TerminalSession.
  useSyncExternalStore(subscribeOutlines, getOutlineVersion, getOutlineVersion);
  const activeOutline = getOutline(activeTabId);

  const startRename = (tab: TabState) => {
    setEditingId(tab.id);
    setEditValue(tab.label);
  };

  const submitRename = (id: string) => {
    if (editValue.trim()) onRenameTab(id, editValue.trim());
    setEditingId(null);
  };

  return (
    <div className={styles.sidebar}>
      <div className={styles.list}>
        {tabs.map((tab, i) => {
          const isActive = tab.id === activeTabId;
          const modeColor = tab.isRemote ? 'var(--color-agent)' : MODE_COLORS[tab.contextMode];
          const title = tab.isRemote && tab.sshTarget ? tab.sshTarget : tab.label;
          const sub = leaf(tab.cwd);
          const row = (
            <div
              onClick={() => onSelectTab(tab.id)}
              onDoubleClick={() => startRename(tab)}
              className={`${styles.tab} ${isActive ? styles.tabActive : ''}`}
              style={{ '--tab-accent': modeColor } as React.CSSProperties}
              title={tab.cwd || title}
            >
              <span className={styles.index}>{i + 1}</span>
              <div className={styles.body}>
                {editingId === tab.id ? (
                  <input
                    autoFocus
                    value={editValue}
                    onChange={e => setEditValue(e.target.value)}
                    onBlur={() => submitRename(tab.id)}
                    onClick={e => e.stopPropagation()}
                    onKeyDown={e => {
                      if (e.key === 'Enter') submitRename(tab.id);
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                    className={styles.editInput}
                  />
                ) : (
                  <span className={styles.label}>{title}</span>
                )}
                {sub && <span className={styles.sub}>{sub}</span>}
              </div>
              {tab.aiWorking && <span className={styles.workingDot} aria-label="AI working" />}
              {isActive && (
                <TrustBadge level={tab.trustLevel} modeColor={modeColor} contextMode={tab.contextMode} isRemote={tab.isRemote} />
              )}
              {tabs.length > 1 && (
                <X
                  size={12}
                  className={styles.closeBtn}
                  onClick={e => { e.stopPropagation(); onCloseTab(tab.id); }}
                />
              )}
            </div>
          );

          // The active tab and its block outline are one object: the accent
          // rail runs out of the tab and down through the blocks as a spine.
          if (!isActive || !activeOutline) return <div key={tab.id}>{row}</div>;
          return (
            <div
              key={tab.id}
              className={styles.group}
              style={{ '--tab-accent': modeColor } as React.CSSProperties}
            >
              {row}
              <BlockOutline
                outline={activeOutline.outline}
                currentId={activeOutline.currentId}
                onNavigate={activeOutline.navigate}
              />
            </div>
          );
        })}
      </div>

      <button className={styles.newTab} onClick={onNewTab}>
        <Plus size={13} />
        <span>New tab</span>
      </button>
    </div>
  );
}
