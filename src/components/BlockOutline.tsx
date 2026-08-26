import { useState } from 'react';
import { formatOutlineDuration, type OutlineKind, type SessionOutline } from '@/utils/sessionOutline';
import styles from './BlockOutline.module.css';

/** Long sessions run to thousands of blocks; the sidebar indexes the recent
    tail and offers the rest behind one click. */
const VISIBLE_CAP = 40;

const KIND_CLASS: Record<OutlineKind, string> = {
  ok: styles.ok,
  fail: styles.fail,
  neutral: styles.neutral,
  ai: styles.ai,
  run: styles.run,
};

interface BlockOutlineProps {
  outline: SessionOutline;
  currentId: string | null;
  onNavigate: (itemId: string) => void;
}

/**
 * The active session's blocks, hanging off the tab's accent rail.
 *
 * The point is the spine, not the text: successes are near-invisible dashes
 * and failures are the only saturated thing in the column, so a session's
 * health reads without anything being read.
 */
export function BlockOutline({ outline, currentId, onNavigate }: BlockOutlineProps) {
  const [expanded, setExpanded] = useState(false);
  const [failuresOnly, setFailuresOnly] = useState(false);

  if (outline.total === 0) return null;

  const filtered = failuresOnly
    ? outline.entries.filter(entry => entry.kind === 'fail')
    : outline.entries;
  const hidden = expanded ? 0 : Math.max(0, filtered.length - VISIBLE_CAP);
  const rows = hidden > 0 ? filtered.slice(hidden) : filtered;

  return (
    <div className={styles.outline}>
      <div className={styles.head}>
        <span>{outline.total} {outline.total === 1 ? 'block' : 'blocks'}</span>
        {outline.failed > 0 && (
          <>
            <span className={styles.headDot}>·</span>
            <button
              type="button"
              className={`${styles.filter} ${failuresOnly ? styles.filterOn : ''}`}
              onClick={() => setFailuresOnly(v => !v)}
              title={failuresOnly ? 'Show all blocks' : 'Show only failures'}
            >
              {outline.failed} failed
            </button>
          </>
        )}
      </div>

      {hidden > 0 && (
        <button type="button" className={styles.more} onClick={() => setExpanded(true)}>
          ↑ {hidden} earlier
        </button>
      )}

      {rows.map(entry => {
        const duration = formatOutlineDuration(entry.durationMs);
        return (
          <button
            type="button"
            key={entry.id}
            className={`${styles.row} ${KIND_CLASS[entry.kind]} ${entry.id === currentId ? styles.current : ''}`}
            onClick={() => onNavigate(entry.id)}
            title={entry.label}
          >
            <span className={styles.tick} aria-hidden="true" />
            <span className={styles.label}>{entry.label}</span>
            {duration && <span className={styles.dur}>{duration}</span>}
          </button>
        );
      })}
    </div>
  );
}
