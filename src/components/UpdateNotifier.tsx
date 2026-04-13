import { Download, RefreshCw, X } from 'lucide-react';
import type { UpdateState } from '../hooks/useUpdateNotifier';
import styles from './UpdateNotifier.module.css';

interface Props {
  state: UpdateState;
  dismissed: boolean;
  onInstall: () => void;
  onDismiss: () => void;
}

const RELEASES_URL = 'https://github.com/darkharasho/tai/releases/latest';

export default function UpdateNotifier({ state, dismissed, onInstall, onDismiss }: Props) {
  if (dismissed) return null;
  if (state.status === 'idle' || state.status === 'checking' || state.status === 'up-to-date') return null;
  if (state.status === 'error') return null;

  return (
    <div className={styles.toast}>
      {state.status === 'available' && (
        <>
          <Download size={14} style={{ color: 'var(--color-info)', flexShrink: 0 }} />
          <span>
            v{state.version} available —{' '}
            <a
              href={RELEASES_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.link}
            >
              download from GitHub
            </a>
          </span>
        </>
      )}

      {state.status === 'downloading' && (
        <>
          <RefreshCw size={14} className={styles.spinning} style={{ color: 'var(--color-info)', flexShrink: 0 }} />
          <span>Downloading update… {state.percent}%</span>
        </>
      )}

      {state.status === 'ready' && (
        <>
          <Download size={14} style={{ color: 'var(--color-success, #4ade80)', flexShrink: 0 }} />
          <span>v{state.version} ready</span>
          <button className={styles.installButton} onClick={onInstall}>
            Restart & Update
          </button>
        </>
      )}

      <button className={styles.dismissButton} onClick={onDismiss}>
        <X size={14} />
      </button>
    </div>
  );
}
