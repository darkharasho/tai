import { bucketOutline, type OutlineKind, type SessionOutline } from '@/utils/sessionOutline';
import styles from './OutlineSparkline.module.css';

const KIND_CLASS: Record<OutlineKind, string> = {
  ok: styles.ok,
  fail: styles.fail,
  neutral: styles.neutral,
  ai: styles.ai,
  run: styles.run,
};

/**
 * A session at a glance, on the tab row's subtitle line.
 *
 * Height encodes what happened (a failure is the full 9px, a success a low
 * stub); opacity encodes recency, so the newest mark is the bright head of
 * the strip. Without that head an ordinary successful command changed
 * nothing you could see — one more dim stub among dozens — and the strip
 * read as static however much work you did.
 */
export function OutlineSparkline({ outline }: { outline: SessionOutline }) {
  const marks = bucketOutline(outline.entries);
  if (marks.length === 0) return null;
  const last = marks.length - 1;
  return (
    <span className={styles.spark} aria-hidden="true">
      {marks.map((kind, i) => (
        <i key={i} className={`${KIND_CLASS[kind]} ${i === last ? styles.head : ''}`} />
      ))}
    </span>
  );
}
