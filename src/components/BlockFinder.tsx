import { useState, useEffect, useRef, useMemo } from 'react';
import { Search, ChevronUp, ChevronDown, X } from 'lucide-react';
import { findMatches } from '@/utils/blockFind';
import type { DisplayItem } from './BlockList';
import styles from './BlockFinder.module.css';

interface BlockFinderProps {
  items: DisplayItem[];
  onClose: () => void;
  /** Called with the item id of the current match whenever it changes. */
  onNavigate: (itemId: string) => void;
}

export function BlockFinder({ items, onClose, onNavigate }: BlockFinderProps) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const matches = useMemo(() => findMatches(items, query), [items, query]);
  const clamped = matches.length ? Math.min(index, matches.length - 1) : 0;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const current = matches[clamped]?.itemId;
  useEffect(() => {
    if (current) onNavigate(current);
    // Deliberately keyed on the resolved target, not the callback identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  const step = (dir: 1 | -1) => {
    if (!matches.length) return;
    setIndex((clamped + dir + matches.length) % matches.length);
  };

  return (
    <div className={styles.finder}>
      <Search size={12} className={styles.icon} />
      <input
        ref={inputRef}
        className={styles.input}
        placeholder="Find in blocks"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setIndex(0); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            step(e.shiftKey ? -1 : 1);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
          }
        }}
      />
      <span className={styles.count}>
        {query.trim() ? `${matches.length ? clamped + 1 : 0}/${matches.length}` : ''}
      </span>
      <button className={styles.btn} title="Previous match" onClick={() => step(-1)}>
        <ChevronUp size={12} />
      </button>
      <button className={styles.btn} title="Next match" onClick={() => step(1)}>
        <ChevronDown size={12} />
      </button>
      <button className={styles.btn} title="Close (Esc)" onClick={onClose}>
        <X size={12} />
      </button>
    </div>
  );
}
