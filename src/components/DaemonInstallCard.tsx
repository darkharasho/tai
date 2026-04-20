import { useState } from 'react';
import styles from './DaemonInstallCard.module.css';

interface Props {
  target: string;
  mode: 'install' | 'update';
  currentVersion?: string;
  newVersion?: string;
  onInstall: () => void;
  onDismiss: () => void;
}

type Status = 'idle' | 'installing' | 'verifying' | 'success' | 'error';

export function DaemonInstallCard({ target, mode, currentVersion, newVersion, onInstall, onDismiss }: Props) {
  const [status, setStatus] = useState<Status>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const actionLabel = mode === 'install' ? 'Install' : 'Update';
  const title = mode === 'install'
    ? `Install TAI Daemon on ${target}?`
    : `Update TAI Daemon on ${target}?`;
  const description = mode === 'install'
    ? `Enables full tool support (Read, Write, Edit, Bash, Grep, Glob) on this host. Installs to ~/.tai/tai-daemon`
    : `Update ${currentVersion} → ${newVersion}. Installs to ~/.tai/tai-daemon`;

  const handleInstall = async () => {
    setStatus('installing');
    const result = await window.tai.daemon.install(target);
    if (!result.success) {
      setStatus('error');
      setErrorMsg(result.error || 'Install failed');
      return;
    }

    setStatus('verifying');
    const check = await window.tai.daemon.check(target);
    if (!check.installed) {
      setStatus('error');
      setErrorMsg('Install completed but daemon not found — try again');
      return;
    }

    setStatus('success');
    onInstall();
    setTimeout(onDismiss, 2000);
  };

  if (status === 'success') {
    return (
      <div className={`${styles.card} ${styles.cardSuccess}`}>
        <div className={styles.statusRow}>
          <span className={styles.successIcon}>✓</span>
          <span className={styles.statusText}>Daemon connected on {target}</span>
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className={`${styles.card} ${styles.cardError}`}>
        <div className={styles.title}>{actionLabel} failed</div>
        <div className={styles.errorMsg}>{errorMsg}</div>
        <div className={styles.actions}>
          <button className={styles.installButton} onClick={handleInstall}>Retry</button>
          <button className={styles.dismissButton} onClick={onDismiss}>Dismiss</button>
        </div>
      </div>
    );
  }

  const busy = status === 'installing' || status === 'verifying';
  const busyLabel = status === 'installing' ? 'Installing…' : 'Verifying…';

  return (
    <div className={styles.card}>
      <div className={styles.title}>{title}</div>
      <div className={styles.description}>{description}</div>
      {busy ? (
        <div className={styles.statusRow}>
          <span className={styles.spinner} />
          <span className={styles.statusText}>{busyLabel}</span>
        </div>
      ) : (
        <div className={styles.actions}>
          <button className={styles.installButton} onClick={handleInstall}>{actionLabel}</button>
          <button className={styles.dismissButton} onClick={onDismiss}>Not now</button>
        </div>
      )}
    </div>
  );
}
