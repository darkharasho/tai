import { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';

interface Props {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmModal({ isOpen, title, message, confirmLabel = 'Close', onConfirm, onCancel }: Props) {
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
      if (e.key === 'Enter') onConfirm();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, onConfirm, onCancel]);

  if (!isOpen) return null;

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
      onClick={onCancel}
    >
      <div
        style={{
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 10,
          width: 400,
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
          gap: 10,
          padding: '16px 20px',
          borderBottom: '1px solid var(--border-subtle)',
        }}>
          <AlertTriangle size={16} style={{ color: 'var(--color-warning, #f59e0b)', flexShrink: 0 }} />
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
            {title}
          </span>
        </div>

        <div style={{
          padding: '16px 20px',
          fontSize: 13,
          lineHeight: 1.6,
          color: 'var(--text-secondary)',
        }}>
          {message}
        </div>

        <div style={{
          padding: '12px 20px',
          borderTop: '1px solid var(--border-subtle)',
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 8,
        }}>
          <button
            onClick={onCancel}
            style={{
              background: 'transparent',
              border: '1px solid var(--border-subtle)',
              borderRadius: 6,
              color: 'var(--text-secondary)',
              fontSize: 13,
              padding: '7px 16px',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            style={{
              background: 'var(--color-error, #ef4444)',
              border: 'none',
              borderRadius: 6,
              color: '#fff',
              fontWeight: 600,
              fontSize: 13,
              padding: '7px 16px',
              cursor: 'pointer',
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
