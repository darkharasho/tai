import { useState } from 'react';
import styles from './DaemonInstallCard.module.css';

interface Props {
  target: string;
  onInstalled: () => void;
  onDismiss: () => void;
}

type Status = 'idle' | 'installing' | 'verifying' | 'success' | 'error';

export function ShellIntegrationInstallCard({ target, onInstalled, onDismiss }: Props) {
  const [status, setStatus] = useState<Status>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const handleInstall = async () => {
    setStatus('installing');
    const result = await window.tai.shellIntegration.installRemote(target);
    if (!result.ok) {
      setStatus('error');
      setErrorMsg(result.error || 'Install failed');
      return;
    }

    setStatus('verifying');
    const check = await window.tai.shellIntegration.checkRemote(target);
    if (!check.installed) {
      setStatus('error');
      setErrorMsg('Install completed but files not found — try again');
      return;
    }

    setStatus('success');
    onInstalled();
    setTimeout(onDismiss, 2500);
  };

  if (status === 'success') {
    return (
      <div className={`${styles.card} ${styles.cardSuccess}`}>
        <div className={styles.statusRow}>
          <span className={styles.successIcon}>✓</span>
          <span className={styles.statusText}>
            Shell integration installed on {target}. Reconnect to activate.
          </span>
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className={`${styles.card} ${styles.cardError}`}>
        <div className={styles.title}>Install failed</div>
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
      <div className={styles.title}>Install shell integration on {target}?</div>
      <div className={styles.description}>
        Adds deterministic block segmentation (OSC 133) for this host. Writes
        ~/.config/tai/shell-integration.sh and a guarded source line to
        ~/.bashrc / ~/.zshrc. Takes effect on next login.
      </div>
      {busy ? (
        <div className={styles.statusRow}>
          <span className={styles.spinner} />
          <span className={styles.statusText}>{busyLabel}</span>
        </div>
      ) : (
        <div className={styles.actions}>
          <button className={styles.installButton} onClick={handleInstall}>Install</button>
          <button className={styles.dismissButton} onClick={onDismiss}>Not now</button>
        </div>
      )}
    </div>
  );
}
