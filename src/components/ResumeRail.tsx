import { useMemo, useState, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { shortenHome } from './CommandBlock';
import styles from './ResumeRail.module.css';

/** Bars in the header sparkline — the tail of the session, not all of it. */
const SPARK_BARS = 24;
const SPARK_MIN_PX = 3;
const SPARK_MAX_PX = 14;

export interface ResumeStat {
  duration: number;
  failed: boolean;
}

interface ResumeRailProps {
  stats: ResumeStat[];
  /** Epoch ms the session was persisted, or null when unknown (older payloads). */
  savedAt: number | null;
  children: ReactNode;
}

/** "2h ago" / "just now" — coarse on purpose, this is a header not a log. */
export function formatAgo(savedAt: number, now: number): string {
  const secs = Math.max(0, Math.round((now - savedAt) / 1000));
  if (secs < 60) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days}d ago`;
}

/**
 * Durations span milliseconds to minutes, so a linear scale flattens
 * everything but the one long build. Log-scale against the slowest bar.
 */
function barHeight(duration: number, max: number): number {
  if (max <= 0) return SPARK_MIN_PX;
  const t = Math.log1p(Math.max(0, duration)) / Math.log1p(max);
  return Math.round(SPARK_MIN_PX + t * (SPARK_MAX_PX - SPARK_MIN_PX));
}

/**
 * The previous session, folded into one rail. Restoring 50 loose collapsed
 * rows made every launch look like a wall of dead output; here they sit
 * behind a header that says what they are and can be folded away entirely.
 * Expanded by default — the scrollback is still where you left it.
 */
export function ResumeRail({ stats, savedAt, children }: ResumeRailProps) {
  const [open, setOpen] = useState(true);

  const failed = stats.filter(s => s.failed).length;
  // Sampled once per mount: a ticking clock here would re-render the whole
  // restored scrollback to move a label from "2h" to "3h".
  const ago = useMemo(() => (savedAt == null ? null : formatAgo(savedAt, Date.now())), [savedAt]);

  const spark = stats.slice(-SPARK_BARS);
  const maxDuration = spark.reduce((m, s) => Math.max(m, s.duration), 0);

  return (
    <div className={`${styles.resume}${open ? ` ${styles.open}` : ''}`}>
      <button
        type="button"
        className={styles.bar}
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
      >
        <span className={styles.chev}><ChevronRight size={11} /></span>
        <span className={styles.label}>Earlier in this tab</span>
        <span className={styles.meta}>
          <span className={styles.dot}>·</span> {stats.length} command{stats.length === 1 ? '' : 's'}
          {failed > 0 && <> <span className={styles.dot}>·</span> {failed} failed</>}
          {ago && <> <span className={styles.dot}>·</span> {ago}</>}
        </span>
        <span className={styles.sparks} aria-hidden="true">
          {spark.map((s, i) => (
            <i
              key={i}
              className={s.failed ? styles.sparkFail : undefined}
              style={{ height: barHeight(s.duration, maxDuration) }}
            />
          ))}
        </span>
      </button>
      <div className={styles.rule} />
      {open && <div className={styles.rows} data-resume-rows>{children}</div>}
    </div>
  );
}

/** cwd heading inside the rail — `cd`-then-work reads as a story. */
export function ResumeGroupHead({ path }: { path: string }) {
  return <div className={styles.groupHead}>{shortenHome(path)}</div>;
}
