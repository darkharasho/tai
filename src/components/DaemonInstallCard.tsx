import React from 'react';
import styles from './DaemonInstallCard.module.css';

interface Props {
  target: string;
  mode: 'install' | 'update';
  currentVersion?: string;
  newVersion?: string;
  onInstall: () => void;
  onDismiss: () => void;
}

export function DaemonInstallCard({ target, mode, currentVersion, newVersion, onInstall, onDismiss }: Props) {
  const title = mode === 'install'
    ? `Install TAI Daemon on ${target}?`
    : `Update TAI Daemon on ${target}?`;

  const description = mode === 'install'
    ? 'Enables full tool support (Read, Write, Edit) on this host. Installs to ~/.tai/tai-daemon'
    : `Update from ${currentVersion} → ${newVersion}. Installs to ~/.tai/tai-daemon`;

  const actionLabel = mode === 'install' ? 'Install' : 'Update';

  return (
    <div className={styles.card}>
      <div className={styles.title}>{title}</div>
      <div className={styles.description}>{description}</div>
      <div className={styles.actions}>
        <button className={styles.installButton} onClick={onInstall}>
          {actionLabel}
        </button>
        <button className={styles.dismissButton} onClick={onDismiss}>
          Not now
        </button>
      </div>
    </div>
  );
}
