import { useState } from 'react';
import { rememberRemoteProbe } from '@/utils/remoteIntegration';
import styles from './ShellIntegrationInstallCard.module.css';

interface Props {
  target: string;
  onInstalled: () => void;
  onDismiss: () => void;
}

type Status = 'idle' | 'installing' | 'verifying' | 'success' | 'error';

/**
 * The offer to install shell integration on a remote host.
 *
 * Renders as a strip inside the session's own block, above the live terminal.
 * The previous standalone card rendered into the scroll history — which the
 * docked xterm covers for the entire duration of an ssh session, i.e. exactly
 * when this offer is the one thing worth seeing.
 */
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
    // Clears the remembered "no integration here" verdict, so the next connect
    // to this host does not pre-emptively take the pane over and then hand it
    // straight back when the first hook arrives.
    rememberRemoteProbe(target, check, localStorage);
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
      <div className={`${styles.strip} ${styles.stripSuccess}`}>
        <span className={`${styles.icon} ${styles.iconSuccess}`}>✓</span>
        <span className={styles.text}>
          <b>Shell integration installed on {target}.</b> <span>Reconnect to activate.</span>
        </span>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className={`${styles.strip} ${styles.stripError}`}>
        <span className={`${styles.icon} ${styles.iconError}`}>⚠</span>
        <span className={styles.text}><b>Install failed.</b></span>
        <span className={styles.errorMsg}>{errorMsg}</span>
        <span className={styles.grow} />
        <button type="button" className={styles.action} onClick={handleInstall}>Retry</button>
        <button type="button" className={styles.dismiss} onClick={onDismiss}>Dismiss</button>
      </div>
    );
  }

  if (status === 'installing' || status === 'verifying') {
    return (
      <div className={styles.strip}>
        <span className={styles.spinner} />
        <span className={styles.text}>
          <span>{status === 'installing' ? `Installing on ${target}…` : 'Verifying…'}</span>
        </span>
      </div>
    );
  }

  return (
    <div className={styles.strip}>
      <span className={styles.icon}>⚠</span>
      <span className={styles.text}>
        <b>No shell integration on this host.</b>{' '}
        <span>Blocks and exit codes are inferred, not observed.</span>
      </span>
      <span className={styles.grow} />
      <button
        type="button"
        className={styles.action}
        onClick={handleInstall}
        title={
          `Writes ~/.config/tai/shell-integration.sh on ${target} and a guarded source line ` +
          'to ~/.bashrc / ~/.zshrc. Takes effect on next login.'
        }
      >
        Install
      </button>
      <button type="button" className={styles.dismiss} onClick={onDismiss}>Not now</button>
    </div>
  );
}
