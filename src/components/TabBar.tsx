import { useState } from 'react';
import { Plus, X, Minus, Square } from 'lucide-react';
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

export function TabBar({ tabs, activeTabId, onSelectTab, onNewTab, onCloseTab, onRenameTab }: TabBarProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  const handleDoubleClick = (tab: TabState) => {
    setEditingId(tab.id);
    setEditValue(tab.label);
  };

  const handleRenameSubmit = (id: string) => {
    if (editValue.trim()) onRenameTab(id, editValue.trim());
    setEditingId(null);
  };

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
      {tabs.map((tab, i) => {
        const isActive = tab.id === activeTabId;
        const modeColor = MODE_COLORS[tab.contextMode];

        return (
          <div
            key={tab.id}
            onClick={() => onSelectTab(tab.id)}
            onDoubleClick={() => handleDoubleClick(tab)}
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
              ...({ WebkitAppRegion: 'no-drag' } as any),
            }}
          >
            <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{i + 1}:</span>
            {editingId === tab.id ? (
              <input
                autoFocus
                value={editValue}
                onChange={e => setEditValue(e.target.value)}
                onBlur={() => handleRenameSubmit(tab.id)}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleRenameSubmit(tab.id);
                  if (e.key === 'Escape') setEditingId(null);
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
                {tab.label}
              </span>
            )}
            {isActive && <TrustBadge level={tab.trustLevel} modeColor={modeColor} contextMode={tab.contextMode} />}
            {tabs.length > 1 && (
              <X
                size={12}
                style={{
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  opacity: isActive ? 0.8 : 0.4,
                }}
                onClick={e => {
                  e.stopPropagation();
                  onCloseTab(tab.id);
                }}
              />
            )}
          </div>
        );
      })}
      <div
        onClick={onNewTab}
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '6px 10px',
          borderRadius: 6,
          cursor: 'pointer',
          ...({ WebkitAppRegion: 'no-drag' } as any),
        }}
      >
        <Plus size={14} style={{ color: 'var(--text-muted)' }} />
      </div>

      <div style={{ flex: 1 }} />

      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 2,
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
