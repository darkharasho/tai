import { useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { X } from 'lucide-react';
import type { FetchStatus, ReleaseEntry } from '../hooks/useWhatsNew';
import styles from './WhatsNewModal.module.css';

interface Props {
  isOpen: boolean;
  version: string;
  releases: ReleaseEntry[];
  fetchStatus: FetchStatus;
  onClose: () => void;
}

export default function WhatsNewModal({ isOpen, version, releases, fetchStatus, onClose }: Props) {
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const githubUrl = 'https://github.com/darkharasho/tai/releases';
  const multiVersion = releases.length > 1;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.headerTitle}>
            {multiVersion ? "What's New" : `What's New in v${version}`}
          </span>
          <button className={styles.closeButton} onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className={styles.body}>
          {fetchStatus === 'loading' && (
            <span className={styles.loadingText}>Loading release notes...</span>
          )}

          {fetchStatus === 'error' && (
            <a
              href={githubUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.errorLink}
            >
              See release notes on GitHub &rarr;
            </a>
          )}

          {fetchStatus === 'success' && releases.length === 0 && (
            <span className={styles.noNotesText}>No release notes available for this version.</span>
          )}

          {fetchStatus === 'success' && releases.length > 0 && (
            <div className={styles.markdown}>
              {releases.map((r, i) => (
                <div key={r.version}>
                  {multiVersion && (
                    <h2
                      className={styles.versionHeading}
                      style={{ margin: i === 0 ? '0 0 8px' : '20px 0 8px' }}
                    >
                      v{r.version}
                    </h2>
                  )}
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{r.notes}</ReactMarkdown>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className={styles.footer}>
          <button className={styles.gotItButton} onClick={onClose}>
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
