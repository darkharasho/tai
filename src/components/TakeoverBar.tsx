import type { ReactNode } from 'react';
import styles from './TakeoverBar.module.css';

interface Props {
  /** `user@host` for a raw ssh session, otherwise the running command. */
  label: string;
  /** Short uppercase descriptor of why the surface was taken over. */
  tag: string;
  remote?: boolean;
  extra?: ReactNode;
  onStop?: () => void;
}

/**
 * The header for a takeover surface (`fullscreen`): a full-screen TUI, or an
 * ssh session on a host with no shell integration.
 *
 * Deliberately a bar and not a card. A takeover exists precisely because TAI
 * cannot see command boundaries or exit codes on that surface — card chrome
 * would claim a structure that is not there, and every pixel it spent was
 * pixels the terminal did not get.
 */
export function TakeoverBar({ label, tag, remote, extra, onStop }: Props) {
  return (
    <div className={styles.bar}>
      <span className={`${styles.dot}${remote ? ` ${styles.dotRemote}` : ''}`} />
      <span className={styles.name} title={label}>{label}</span>
      {extra}
      <span className={styles.grow} />
      <span className={styles.tag}>{tag}</span>
      {onStop && (
        <button type="button" className={styles.stop} onClick={onStop}>stop</button>
      )}
    </div>
  );
}
