import { useState, useRef, useEffect, useCallback } from 'react';
import { Plus, X, Minus, Square, ChevronDown } from 'lucide-react';
import type { TabState, ContextMode } from '@/types';
import { TrustBadge } from './TrustBadge';

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
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 14px',
        borderRadius: 6,
        cursor: 'pointer',
        background: isActive ? 'rgba(255,255,255,0.06)' : 'transparent',
        borderBottom: isActive ? `2px solid ${modeColor}` : '2px solid transparent',
        transition: 'all 0.2s ease',
        whiteSpace: 'nowrap',
        flexShrink: 0,
        ...({ WebkitAppRegion: 'no-drag' } as any),
      }}
    >
      <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{index + 1}:</span>
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
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--text-primary)',
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            outline: 'none',
            width: 80,
          }}
        />
      ) : (
        <span style={{
          color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
          fontSize: 12,
        }}>
          {tab.isRemote && tab.sshTarget ? tab.sshTarget : tab.label}
        </span>
      )}
      {isActive && <TrustBadge level={tab.trustLevel} modeColor={modeColor} contextMode={tab.contextMode} isRemote={tab.isRemote} />}
      {tabCount > 1 && (
        <X
          size={12}
          style={{
            color: 'var(--text-muted)',
            cursor: 'pointer',
            opacity: isActive ? 0.8 : 0.4,
          }}
          onClick={onClose}
        />
      )}
    </div>
  );
}

export function TabBar({ tabs, activeTabId, onSelectTab, onNewTab, onCloseTab, onRenameTab }: TabBarProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [maxVisible, setMaxVisible] = useState(tabs.length);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const tabsContainerRef = useRef<HTMLDivElement>(null);
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
    const container = tabsContainerRef.current;
    if (!container) return;
    const children = Array.from(container.children) as HTMLElement[];
    if (children.length === 0) return;

    const containerRight = container.getBoundingClientRect().right;
    let visible = children.length;
    for (let i = 0; i < children.length; i++) {
      const childRight = children[i].getBoundingClientRect().right;
      if (childRight > containerRight + 1) {
        visible = i;
        break;
      }
    }
    setMaxVisible(Math.max(1, visible));
  }, []);

  useEffect(() => {
    const container = tabsContainerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(recalculate);
    ro.observe(container);
    return () => ro.disconnect();
  }, [recalculate]);

  useEffect(() => {
    recalculate();
  }, [tabs.length, recalculate]);

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
  const visibleTabs = tabs.slice(0, maxVisible);
  const overflowTabs = tabs.slice(maxVisible);
  const activeInOverflow = overflowTabs.some(t => t.id === activeTabId);

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 4,
      padding: '6px 12px',
      borderBottom: '1px solid var(--border-subtle)',
      background: 'var(--bg-surface)',
      ...({ WebkitAppRegion: 'drag' } as any),
      userSelect: 'none',
      minHeight: 40,
    }}>
      <div
        ref={tabsContainerRef}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
        }}
      >
        {visibleTabs.map((tab, i) => {
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

      {hasOverflow && (
        <div ref={overflowRef} style={{ position: 'relative', flexShrink: 0, ...({ WebkitAppRegion: 'no-drag' } as any) }}>
          <div
            onClick={() => setOverflowOpen(v => !v)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: '6px 8px',
              borderRadius: 6,
              cursor: 'pointer',
              background: activeInOverflow ? 'rgba(255,255,255,0.06)' : 'transparent',
            }}
          >
            <ChevronDown size={14} style={{ color: 'var(--text-muted)' }} />
            <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>+{overflowTabs.length}</span>
          </div>
          {overflowOpen && (
            <div style={{
              position: 'absolute',
              top: '100%',
              right: 0,
              marginTop: 4,
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 8,
              boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
              zIndex: 3000,
              minWidth: 180,
              padding: '4px 0',
              maxHeight: 300,
              overflowY: 'auto',
            }}>
              {overflowTabs.map((tab, i) => {
                const globalIndex = maxVisible + i;
                const isActive = tab.id === activeTabId;
                const modeColor = tab.isRemote ? 'var(--color-agent)' : MODE_COLORS[tab.contextMode];
                return (
                  <div
                    key={tab.id}
                    onClick={() => { onSelectTab(tab.id); setOverflowOpen(false); }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '6px 12px',
                      cursor: 'pointer',
                      background: isActive ? 'rgba(255,255,255,0.06)' : 'transparent',
                      borderLeft: isActive ? `2px solid ${modeColor}` : '2px solid transparent',
                    }}
                  >
                    <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{globalIndex + 1}:</span>
                    <span style={{
                      color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                      fontSize: 12,
                      flex: 1,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {tab.isRemote && tab.sshTarget ? tab.sshTarget : tab.label}
                    </span>
                    {tabs.length > 1 && (
                      <X
                        size={12}
                        style={{ color: 'var(--text-muted)', cursor: 'pointer', opacity: 0.5, flexShrink: 0 }}
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

      <div
        onClick={onNewTab}
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '6px 10px',
          borderRadius: 6,
          cursor: 'pointer',
          flexShrink: 0,
          ...({ WebkitAppRegion: 'no-drag' } as any),
        }}
      >
        <Plus size={14} style={{ color: 'var(--text-muted)' }} />
      </div>

      <div style={{ flex: 'none', width: 8 }} />

      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        flexShrink: 0,
        ...({ WebkitAppRegion: 'no-drag' } as any),
      }}>
        <button
          onClick={() => window.tai?.window?.minimize()}
          style={{
            background: 'transparent',
            border: 'none',
            padding: '4px 8px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            borderRadius: 4,
          }}
        >
          <Minus size={14} color="var(--text-muted)" />
        </button>
        <button
          onClick={() => window.tai?.window?.maximize()}
          style={{
            background: 'transparent',
            border: 'none',
            padding: '4px 8px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            borderRadius: 4,
          }}
        >
          <Square size={12} color="var(--text-muted)" />
        </button>
        <button
          onClick={() => window.tai?.window?.close()}
          style={{
            background: 'transparent',
            border: 'none',
            padding: '4px 8px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            borderRadius: 4,
          }}
        >
          <X size={14} color="var(--text-muted)" />
        </button>
      </div>
    </div>
  );
}
