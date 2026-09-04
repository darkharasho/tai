import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Plus, X } from 'lucide-react';
import type { TabState, ContextMode } from '@/types';
import { TrustBadge } from './TrustBadge';
import { OutlineSparkline } from './OutlineSparkline';
import { OutlineFlyout } from './OutlineFlyout';
import { getOutline, getOutlineVersion, subscribeOutlines } from '@/stores/outlineStore';
import styles from './TabSidebar.module.css';

const MODE_COLORS: Record<ContextMode, string> = {
  shell: 'var(--color-shell)',
  ai: 'var(--color-ai)',
  agent: 'var(--color-agent)',
  error: 'var(--color-error)',
};

/**
 * How far the active row's background is mixed toward its mode colour.
 *
 * Per mode rather than one number, because equal percentages are not equal
 * weights: agent orange at 9% shouts where shell green at 9% murmurs. These
 * are tuned so all four modes land at the same apparent lift.
 */
const MODE_TINTS: Record<ContextMode, string> = {
  shell: '9%',
  ai: '7%',
  agent: '5%',
  error: '5%',
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
 *
 * Each row's subtitle line carries a sparkline of that session — including
 * the tabs you are not looking at, which is the whole reason the block list
 * moved out of the sidebar and into a flyout. Ambient health here, names on
 * demand there.
 */
export function TabSidebar({ tabs, activeTabId, onSelectTab, onNewTab, onCloseTab, onRenameTab }: TabSidebarProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  /** Which tab's blocks are open, and where its row sat when it opened. */
  const [flyout, setFlyout] = useState<{ tabId: string; top: number } | null>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());

  // Subscribing to the outline store here (rather than holding outlines in
  // App) keeps block churn from re-rendering every mounted TerminalSession.
  useSyncExternalStore(subscribeOutlines, getOutlineVersion, getOutlineVersion);

  const openFlyout = useCallback((tabId: string) => {
    const row = rowRefs.current.get(tabId);
    if (!row) return;
    setFlyout({ tabId, top: Math.max(6, row.getBoundingClientRect().top - 8) });
  }, []);

  // Cmd/Ctrl+O opens the active session's blocks. Bound here rather than in
  // App because the panel's position comes from a row this component owns.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'o' || !(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
      e.preventDefault();
      if (flyout?.tabId === activeTabId) setFlyout(null);
      else openFlyout(activeTabId);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeTabId, openFlyout, flyout]);

  // A tab closing (or the rail scrolling) would leave the panel pointing at
  // nothing, so it does not outlive its anchor.
  useEffect(() => {
    if (flyout && !tabs.some(tab => tab.id === flyout.tabId)) setFlyout(null);
  }, [tabs, flyout]);

  const startRename = (tab: TabState) => {
    setEditingId(tab.id);
    setEditValue(tab.label);
  };

  const submitRename = (id: string) => {
    if (editValue.trim()) onRenameTab(id, editValue.trim());
    setEditingId(null);
  };

  const flyoutOutline = flyout ? getOutline(flyout.tabId) : undefined;

  return (
    <div className={styles.sidebar}>
      <div className={styles.list} onScroll={() => setFlyout(null)}>
        {tabs.map((tab, i) => {
          const isActive = tab.id === activeTabId;
          const modeColor = tab.isRemote ? 'var(--color-agent)' : MODE_COLORS[tab.contextMode];
          const modeTint = tab.isRemote ? MODE_TINTS.agent : MODE_TINTS[tab.contextMode];
          const title = tab.isRemote && tab.sshTarget ? tab.sshTarget : tab.label;
          const sub = leaf(tab.cwd);
          const outline = getOutline(tab.id)?.outline;

          return (
            <div
              key={tab.id}
              ref={el => { if (el) rowRefs.current.set(tab.id, el); else rowRefs.current.delete(tab.id); }}
              onClick={() => onSelectTab(tab.id)}
              onDoubleClick={() => startRename(tab)}
              className={`${styles.tab} ${isActive ? styles.tabActive : ''}`}
              style={{ '--tab-accent': modeColor, '--tab-tint': modeTint } as React.CSSProperties}
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
                {/* Selecting the tab and opening its blocks are one gesture:
                    the panel always describes the session you are now in, so
                    there is no reading one tab's blocks from inside another. */}
                <div
                  className={`${styles.meta} ${outline?.total ? styles.metaLive : ''}`}
                  onClick={e => {
                    if (!outline?.total) return;
                    e.stopPropagation();
                    onSelectTab(tab.id);
                    if (flyout?.tabId === tab.id) setFlyout(null);
                    else openFlyout(tab.id);
                  }}
                  onDoubleClick={e => e.stopPropagation()}
                >
                  {sub && <span className={styles.sub}>{sub}</span>}
                  {outline && outline.total > 0 && (
                    <>
                      {sub && <span className={styles.metaDot}>·</span>}
                      <OutlineSparkline outline={outline} />
                      {outline.failed > 0 && <span className={styles.failCount}>{outline.failed}</span>}
                      <span className={styles.chevron} aria-hidden="true">▸</span>
                    </>
                  )}
                </div>
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
        })}
      </div>

      {flyout && flyoutOutline && flyoutOutline.outline.total > 0 && (
        <OutlineFlyout
          outline={flyoutOutline.outline}
          currentId={flyoutOutline.currentId}
          anchorTop={flyout.top}
          onNavigate={flyoutOutline.navigate}
          onClose={() => setFlyout(null)}
        />
      )}

      <button className={styles.newTab} onClick={onNewTab}>
        <Plus size={13} />
        <span>New tab</span>
      </button>
    </div>
  );
}
