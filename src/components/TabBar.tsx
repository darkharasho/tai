import { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { Plus, X, Minus, Square, ChevronDown, Settings } from 'lucide-react';

const isMac = window.tai?.system?.platform === 'darwin';
import type { TabState, ContextMode } from '@/types';
import { TrustBadge } from './TrustBadge';
import styles from './TabBar.module.css';

const MODE_COLORS: Record<ContextMode, string> = {
  shell: 'var(--color-shell)',
  ai: 'var(--color-ai)',
  agent: 'var(--color-agent)',
  error: 'var(--color-error)',
};

interface TabBarProps {
  tabs: TabState[];
  activeTabId: string;
  onSelectTab: (id: string) => void;
  onNewTab: () => void;
  onCloseTab: (id: string) => void;
  onRenameTab: (id: string, label: string) => void;
  onOpenQuickSettings: () => void;
}

function TabItem({ tab, index, isActive, modeColor, tabCount, editingId, editValue, onSelect, onDoubleClick, onEditChange, onEditSubmit, onEditCancel, onClose }: {
  tab: TabState;
  index: number;
  isActive: boolean;
  modeColor: string;
  tabCount: number;
  editingId: string | null;
  editValue: string;
  onSelect: () => void;
  onDoubleClick: () => void;
  onEditChange: (v: string) => void;
  onEditSubmit: () => void;
  onEditCancel: () => void;
  onClose: (e: React.MouseEvent) => void;
}) {
  return (
    <div
      onClick={onSelect}
      onDoubleClick={onDoubleClick}
      className={`${styles.tab} ${isActive ? styles.tabActive : ''}`}
      style={{ '--tab-accent': modeColor } as React.CSSProperties}
    >
      {isActive && <div className={styles.tabGlow} />}
      <span className={styles.tabIndex}>{index + 1}:</span>
      {tab.aiWorking && (
        <span className={styles.workingDot} aria-label="AI working" />
      )}
      {editingId === tab.id ? (
        <input
          autoFocus
          value={editValue}
          onChange={e => onEditChange(e.target.value)}
          onBlur={onEditSubmit}
          onKeyDown={e => {
            if (e.key === 'Enter') onEditSubmit();
            if (e.key === 'Escape') onEditCancel();
          }}
          className={styles.editInput}
        />
      ) : (
        <span className={`${styles.tabLabel} ${isActive ? styles.tabLabelActive : ''}`}>
          {tab.isRemote && tab.sshTarget ? tab.sshTarget : tab.label}
        </span>
      )}
      {isActive && <TrustBadge level={tab.trustLevel} modeColor={modeColor} contextMode={tab.contextMode} isRemote={tab.isRemote} />}
      {tabCount > 1 && (
        <X
          size={12}
          className={styles.closeBtn}
          style={{ opacity: isActive ? 0.8 : 0.4 }}
          onClick={onClose}
        />
      )}
    </div>
  );
}

export function TabBar({ tabs, activeTabId, onSelectTab, onNewTab, onCloseTab, onRenameTab, onOpenQuickSettings }: TabBarProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [maxVisible, setMaxVisible] = useState(Infinity);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);
  const tabsContainerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const fixedRef = useRef<HTMLDivElement>(null);
  const overflowRef = useRef<HTMLDivElement>(null);

  const handleDoubleClick = (tab: TabState) => {
    setEditingId(tab.id);
    setEditValue(tab.label);
  };

  const handleRenameSubmit = (id: string) => {
    if (editValue.trim()) onRenameTab(id, editValue.trim());
    setEditingId(null);
  };

  const recalculate = useCallback(() => {
    const bar = barRef.current;
    const measure = measureRef.current;
    const fixed = fixedRef.current;
    if (!bar || !measure || !fixed) return;
    const children = Array.from(measure.children) as HTMLElement[];
    if (children.length === 0) return;

    const barPadding = 24;
    const gap = 4;
    const barWidth = bar.clientWidth - barPadding;
    const fixedWidth = fixed.offsetWidth + gap;
    const overflowBtnReserve = 54;

    let usedWidth = 0;
    for (let i = 0; i < children.length; i++) {
      usedWidth += children[i].offsetWidth + (i > 0 ? gap : 0);
    }
    if (usedWidth + fixedWidth <= barWidth) {
      setMaxVisible(children.length);
      return;
    }

    const available = barWidth - fixedWidth - overflowBtnReserve;
    usedWidth = 0;
    let fits = children.length;
    for (let i = 0; i < children.length; i++) {
      usedWidth += children[i].offsetWidth + (i > 0 ? gap : 0);
      if (usedWidth > available) {
        fits = i;
        break;
      }
    }
    setMaxVisible(Math.max(1, fits));
  }, []);

  useLayoutEffect(() => {
    recalculate();
  }, [tabs.length, recalculate]);

  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const ro = new ResizeObserver(recalculate);
    ro.observe(bar);
    return () => ro.disconnect();
  }, [recalculate]);

  useEffect(() => {
    if (!overflowOpen) return;
    const handler = (e: MouseEvent) => {
      if (overflowRef.current && !overflowRef.current.contains(e.target as Node)) {
        setOverflowOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [overflowOpen]);

  const hasOverflow = tabs.length > maxVisible;
  const overflowTabs = hasOverflow ? tabs.slice(maxVisible) : [];
  const activeOverflowTab = overflowTabs.find(t => t.id === activeTabId);
  const activeOverflowColor = activeOverflowTab
    ? (activeOverflowTab.isRemote ? 'var(--color-agent)' : MODE_COLORS[activeOverflowTab.contextMode])
    : null;

  return (
    <div ref={barRef} className={`${styles.bar}${isMac ? ` ${styles.barMac}` : ''}`}>
      <div
        ref={tabsContainerRef}
        className={styles.tabsContainer}
      >
        {tabs.slice(0, maxVisible).map((tab, i) => {
          const isActive = tab.id === activeTabId;
          const modeColor = tab.isRemote ? 'var(--color-agent)' : MODE_COLORS[tab.contextMode];
          return (
            <TabItem
              key={tab.id}
              tab={tab}
              index={i}
              isActive={isActive}
              modeColor={modeColor}
              tabCount={tabs.length}
              editingId={editingId}
              editValue={editValue}
              onSelect={() => onSelectTab(tab.id)}
              onDoubleClick={() => handleDoubleClick(tab)}
              onEditChange={setEditValue}
              onEditSubmit={() => handleRenameSubmit(tab.id)}
              onEditCancel={() => setEditingId(null)}
              onClose={(e) => { e.stopPropagation(); onCloseTab(tab.id); }}
            />
          );
        })}
      </div>

      <div
        ref={measureRef}
        aria-hidden
        className={styles.measureContainer}
      >
        {tabs.map((tab, i) => (
          <TabItem
            key={tab.id}
            tab={tab}
            index={i}
            isActive={false}
            modeColor="transparent"
            tabCount={tabs.length}
            editingId={null}
            editValue=""
            onSelect={() => {}}
            onDoubleClick={() => {}}
            onEditChange={() => {}}
            onEditSubmit={() => {}}
            onEditCancel={() => {}}
            onClose={() => {}}
          />
        ))}
      </div>

      {hasOverflow && (
        <div ref={overflowRef} className={styles.overflowWrapper}>
          <div
            onClick={() => setOverflowOpen(v => !v)}
            className={`${styles.overflowBtn} ${activeOverflowColor ? styles.overflowBtnActive : ''}`}
            style={activeOverflowColor ? { '--tab-accent': activeOverflowColor } as React.CSSProperties : undefined}
          >
            <ChevronDown size={14} style={{ color: activeOverflowColor || 'var(--text-muted)' }} />
            <span style={{ color: activeOverflowColor || 'var(--text-muted)', fontSize: 11 }}>+{overflowTabs.length}</span>
          </div>
          {overflowOpen && (
            <div className={styles.overflowDropdown}>
              {overflowTabs.map((tab, i) => {
                const globalIndex = maxVisible + i;
                const isActive = tab.id === activeTabId;
                const modeColor = tab.isRemote ? 'var(--color-agent)' : MODE_COLORS[tab.contextMode];
                return (
                  <div
                    key={tab.id}
                    onClick={() => { onSelectTab(tab.id); setOverflowOpen(false); }}
                    className={`${styles.overflowItem} ${isActive ? styles.overflowItemActive : ''}`}
                    style={{ '--tab-accent': modeColor } as React.CSSProperties}
                  >
                    <span className={styles.tabIndex}>{globalIndex + 1}:</span>
                    <span
                      className={`${styles.overflowItemLabel} ${isActive ? styles.overflowItemLabelActive : ''}`}
                    >
                      {tab.isRemote && tab.sshTarget ? tab.sshTarget : tab.label}
                    </span>
                    {tabs.length > 1 && (
                      <X
                        size={12}
                        className={styles.closeBtn}
                        style={{ opacity: 0.5, flexShrink: 0 }}
                        onClick={(e) => { e.stopPropagation(); onCloseTab(tab.id); }}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div ref={fixedRef} className={styles.fixedControls}>
        <div onClick={onNewTab} className={styles.addBtn}>
          <Plus size={14} style={{ color: 'var(--text-muted)' }} />
        </div>

        <div onClick={onOpenQuickSettings} className={styles.cogBtn}>
          <Settings size={13} style={{ color: 'var(--text-muted)' }} />
        </div>

        {!isMac && (
          <>
            <div className={styles.separator} />
            <div className={styles.windowControls}>
              <button
                onClick={() => window.tai?.window?.minimize()}
                className={styles.windowBtn}
              >
                <Minus size={14} />
              </button>
              <button
                onClick={() => window.tai?.window?.maximize()}
                className={styles.windowBtn}
              >
                <Square size={12} />
              </button>
              <button
                onClick={() => window.tai?.window?.close()}
                className={styles.windowBtn}
              >
                <X size={14} />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
