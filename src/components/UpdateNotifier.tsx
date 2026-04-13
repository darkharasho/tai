import { Download, RefreshCw, X } from 'lucide-react';
import type { UpdateState } from '../hooks/useUpdateNotifier';

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
    <div style={{
      position: 'fixed',
      bottom: 16,
      right: 16,
      zIndex: 2500,
      background: 'var(--bg-elevated)',
      border: '1px solid var(--border-subtle)',
      borderRadius: 8,
      padding: '10px 14px',
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
      fontSize: 13,
      color: 'var(--text-primary)',
      maxWidth: 360,
    }}>
      {state.status === 'available' && (
        <>
          <Download size={14} style={{ color: 'var(--color-info)', flexShrink: 0 }} />
          <span>
            v{state.version} available —{' '}
            <a
              href={RELEASES_URL}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: 'var(--color-info)', textDecoration: 'underline', cursor: 'pointer' }}
            >
              download from GitHub
            </a>
          </span>
        </>
      )}

      {state.status === 'downloading' && (
        <>
          <RefreshCw size={14} style={{ color: 'var(--color-info)', flexShrink: 0, animation: 'spin 1s linear infinite' }} />
          <span>Downloading update… {state.percent}%</span>
        </>
      )}

      {state.status === 'ready' && (
        <>
          <Download size={14} style={{ color: 'var(--color-success, #4ade80)', flexShrink: 0 }} />
          <span>v{state.version} ready</span>
          <button
            onClick={onInstall}
            style={{
              background: 'var(--color-shell)',
              border: 'none',
              borderRadius: 5,
              color: '#000',
              fontWeight: 600,
              fontSize: 12,
              padding: '4px 10px',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            Restart & Update
          </button>
        </>
      )}

      <button
        onClick={onDismiss}
        style={{
          background: 'none',
          border: 'none',
          color: 'var(--text-muted)',
          cursor: 'pointer',
          padding: 2,
          borderRadius: 4,
          display: 'flex',
          flexShrink: 0,
          marginLeft: 'auto',
        }}
      >
        <X size={14} />
      </button>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
