import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { formatOutlineDuration, type OutlineEntry, type OutlineKind, type SessionOutline } from '@/utils/sessionOutline';
import styles from './OutlineFlyout.module.css';

const KIND_CLASS: Record<OutlineKind, string> = {
  ok: styles.ok,
  fail: styles.fail,
  neutral: styles.neutral,
  ai: styles.ai,
  run: styles.run,
};

interface OutlineFlyoutProps {
  outline: SessionOutline;
  currentId: string | null;
  /** Viewport top of the row this hangs off, so the panel points at it. */
  anchorTop: number;
  onNavigate: (itemId: string) => void;
  onClose: () => void;
}

/**
 * The active session's blocks, as a panel hung off the tab's meta line.
 *
 * The list used to live inline in the sidebar, which meant a 200px-wide
 * column of monospace competing with the tabs above it. Here it floats over
 * the terminal instead: the rail stays a rail, and the list gets the room to
 * carry a filter — which is what lets it drop the old 40-row cap, since
 * reaching an old block is now typing rather than scrolling.
 */
export function OutlineFlyout({ outline, currentId, anchorTop, onNavigate, onClose }: OutlineFlyoutProps) {
  const [query, setQuery] = useState('');
  const [failuresOnly, setFailuresOnly] = useState(false);
  const [selected, setSelected] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const rowsRef = useRef<OutlineEntry[]>([]);
  const panelRef = useRef<HTMLDivElement>(null);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return outline.entries.filter(entry => {
      if (failuresOnly && entry.kind !== 'fail') return false;
      return !needle || entry.label.toLowerCase().includes(needle);
    });
  }, [outline.entries, query, failuresOnly]);
  // Read by the reset effect below, which must not re-run when `rows` changes.
  rowsRef.current = rows;

  // Open on the block you are looking at, not on the top of the session; with
  // the filter empty that is the bottom of a long list. Keyed on the filter
  // rather than on `rows`, because `rows` is rebuilt on every line of output
  // from a running command and resetting there would fight the arrow keys.
  useLayoutEffect(() => {
    const at = rowsRef.current.findIndex(entry => entry.id === currentId);
    setSelected(at >= 0 ? at : Math.max(0, rowsRef.current.length - 1));
  }, [query, failuresOnly, currentId]);

  // Output arriving under an open panel can shorten the filtered list.
  useEffect(() => {
    setSelected(i => Math.min(i, Math.max(0, rows.length - 1)));
  }, [rows.length]);

  useEffect(() => {
    const row = listRef.current?.querySelector<HTMLElement>('[data-sel="1"]');
    // Optional call: jsdom has no scrollIntoView, and this is decoration.
    row?.scrollIntoView?.({ block: 'nearest' });
  }, [selected]);

  // A click anywhere else is a dismissal. Captured on mousedown so a click
  // that lands on a terminal block does not also get eaten by the panel.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!panelRef.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', onDown, true);
    return () => document.removeEventListener('mousedown', onDown, true);
  }, [onClose]);

  const jump = (entry: OutlineEntry | undefined, keepOpen: boolean) => {
    if (!entry) return;
    onNavigate(entry.id);
    if (!keepOpen) onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected(i => Math.min(rows.length - 1, i + 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected(i => Math.max(0, i - 1));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      jump(rows[selected], e.metaKey || e.ctrlKey);
    }
  };

  return (
    <div
      ref={panelRef}
      className={styles.flyout}
      style={{ top: anchorTop }}
      role="dialog"
      aria-label="Session blocks"
      onKeyDown={onKeyDown}
    >
      <div className={styles.head}>
        <span>{outline.total} {outline.total === 1 ? 'block' : 'blocks'}</span>
        {outline.failed > 0 && (
          <button
            type="button"
            className={`${styles.pill} ${failuresOnly ? styles.pillOn : ''}`}
            onClick={() => setFailuresOnly(v => !v)}
          >
            {outline.failed} failed
          </button>
        )}
      </div>

      <div className={styles.search}>
        <input
          autoFocus
          value={query}
          spellCheck={false}
          placeholder="Filter blocks…"
          onChange={e => setQuery(e.target.value)}
          className={styles.input}
        />
      </div>

      <div className={styles.list} ref={listRef}>
        {rows.length === 0 && <div className={styles.empty}>No matching blocks</div>}
        {rows.map((entry, i) => {
          const duration = formatOutlineDuration(entry.durationMs);
          return (
            <button
              type="button"
              key={entry.id}
              data-sel={i === selected ? '1' : undefined}
              className={[
                styles.row,
                KIND_CLASS[entry.kind],
                i === selected ? styles.selected : '',
                entry.id === currentId ? styles.current : '',
              ].filter(Boolean).join(' ')}
              onMouseEnter={() => setSelected(i)}
              onClick={e => jump(entry, e.metaKey || e.ctrlKey)}
              title={entry.label}
            >
              <span className={styles.tick} aria-hidden="true" />
              <span className={styles.label}>{entry.label}</span>
              {duration && <span className={styles.dur}>{duration}</span>}
            </button>
          );
        })}
      </div>

      <div className={styles.foot}>
        <span><b>↑↓</b> move</span>
        <span><b>⏎</b> jump</span>
        <span><b>esc</b> close</span>
      </div>
    </div>
  );
}
