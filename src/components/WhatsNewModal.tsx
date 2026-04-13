import { useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { X } from 'lucide-react';
import type { FetchStatus, ReleaseEntry } from '../hooks/useWhatsNew';

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
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 3000,
        backdropFilter: 'blur(4px)',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 10,
          width: 560,
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
          overflow: 'hidden',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 20px',
          borderBottom: '1px solid var(--border-subtle)',
          flexShrink: 0,
        }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
            {multiVersion ? "What's New" : `What's New in v${version}`}
          </span>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              padding: 4,
              borderRadius: 4,
              display: 'flex',
            }}
          >
            <X size={16} />
          </button>
        </div>

        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: '20px',
          minHeight: 0,
          fontSize: 13,
          lineHeight: 1.6,
          color: 'var(--text-primary)',
        }}>
          {fetchStatus === 'loading' && (
            <span style={{ color: 'var(--text-muted)' }}>Loading release notes...</span>
          )}

          {fetchStatus === 'error' && (
            <a
              href={githubUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: 'var(--color-info)', textDecoration: 'underline', cursor: 'pointer' }}
            >
              See release notes on GitHub &rarr;
            </a>
          )}

          {fetchStatus === 'success' && releases.length === 0 && (
            <span style={{ color: 'var(--text-muted)' }}>No release notes available for this version.</span>
          )}

          {fetchStatus === 'success' && releases.length > 0 && (
            <div className="whats-new-markdown">
              {releases.map((r, i) => (
                <div key={r.version}>
                  {multiVersion && (
                    <h2 style={{
                      fontSize: 14,
                      fontWeight: 600,
                      color: 'var(--text-primary)',
                      margin: i === 0 ? '0 0 8px' : '20px 0 8px',
                      paddingBottom: 6,
                      borderBottom: '1px solid var(--border-subtle)',
                    }}>
                      v{r.version}
                    </h2>
                  )}
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{r.notes}</ReactMarkdown>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{
          padding: '12px 20px',
          borderTop: '1px solid var(--border-subtle)',
          display: 'flex',
          justifyContent: 'flex-end',
          flexShrink: 0,
        }}>
          <button
            onClick={onClose}
            style={{
              background: 'var(--color-shell)',
              border: 'none',
              borderRadius: 6,
              color: '#000',
              fontWeight: 600,
              fontSize: 13,
              padding: '7px 16px',
              cursor: 'pointer',
            }}
          >
            Got it
          </button>
        </div>
      </div>

      <style>{`
        .whats-new-markdown h1,
        .whats-new-markdown h2,
        .whats-new-markdown h3 {
          color: var(--text-primary);
          margin: 12px 0 6px;
          font-weight: 600;
        }
        .whats-new-markdown h2 { font-size: 14px; }
        .whats-new-markdown h3 { font-size: 13px; }
        .whats-new-markdown p { margin: 0 0 8px; }
        .whats-new-markdown ul,
        .whats-new-markdown ol { margin: 0 0 8px; padding-left: 20px; }
        .whats-new-markdown li { margin-bottom: 3px; }
        .whats-new-markdown code {
          background: var(--bg-surface);
          border-radius: 3px;
          padding: 1px 4px;
          font-family: var(--font-mono);
          font-size: 12px;
        }
        .whats-new-markdown a { color: var(--color-info); }
      `}</style>
    </div>
  );
}
