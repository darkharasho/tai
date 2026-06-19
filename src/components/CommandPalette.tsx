import { useState, useEffect, useRef } from 'react';
import { rankPaletteItems } from '@/utils/palette';
import type { PaletteItem } from '@/utils/palette';
import styles from './CommandPalette.module.css';

interface Props {
  open: boolean;
  items: PaletteItem[];
  onPick: (item: PaletteItem, runNow: boolean) => void;
  onClose: () => void;
}

export function CommandPalette({ open, items, onPick, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const ranked = rankPaletteItems(query, items);

  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIdx(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => {
    setSelectedIdx(0);
  }, [query]);

  if (!open) return null;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { onClose(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx(i => Math.min(i + 1, ranked.length - 1)); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIdx(i => Math.max(i - 1, 0)); return; }
    if (e.key === 'Enter') {
      const runNow = e.metaKey || e.ctrlKey;
      const sel = ranked[selectedIdx];
      if (sel) onPick(sel, runNow);
      return;
    }
  };

  const sourceTag = (src: PaletteItem['source']) => {
    const labels: Record<string, string> = { history: 'hist', workflow: 'flow', command: 'cmd' };
    return labels[src] ?? src;
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <input
          ref={inputRef}
          role="textbox"
          className={styles.input}
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search commands, workflows..."
        />
        <div className={styles.list}>
          {ranked.map((item, i) => (
            <div
              key={item.id}
              className={`${styles.item} ${i === selectedIdx ? styles.itemSelected : ''}`}
              onMouseEnter={() => setSelectedIdx(i)}
              onClick={() => onPick(item, false)}
            >
              <span className={styles.label}>{item.label}</span>
              {item.description && <span className={styles.description}>{item.description}</span>}
              <span className={styles.source}>{sourceTag(item.source)}</span>
            </div>
          ))}
          {ranked.length === 0 && query && (
            <div className={styles.empty}>No results for "{query}"</div>
          )}
        </div>
      </div>
    </div>
  );
}
