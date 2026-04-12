import { useEffect } from 'react';
import { Check, Pencil, X } from 'lucide-react';

interface ApprovalPromptProps {
  id: string;
  command: string;
  status: 'pending' | 'approved' | 'rejected' | 'edited';
  onApprove: () => void;
  onReject: () => void;
  onEdit: () => void;
}

export function ApprovalPrompt({ command, status, onApprove, onReject, onEdit }: ApprovalPromptProps) {
  useEffect(() => {
    if (status !== 'pending') return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.ctrlKey && !e.shiftKey) { e.preventDefault(); onApprove(); }
      if (e.key === 'e' && !e.ctrlKey) { e.preventDefault(); onEdit(); }
      if (e.key === 'Escape') { e.preventDefault(); onReject(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [status, onApprove, onReject, onEdit]);

  const resolved = status !== 'pending';

  return (
    <div style={{
      margin: '8px 0',
      padding: '10px 14px',
      background: 'rgba(251, 146, 60, 0.06)',
      border: '1px solid rgba(251, 146, 60, 0.2)',
      borderRadius: 8,
      opacity: resolved ? 0.5 : 1,
      animation: 'fadeIn 0.2s ease',
    }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: '#e0e0e0' }}>
        <span style={{ color: '#fb923c' }}>❯</span> {command}
      </div>
      {!resolved && (
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button
            onClick={onEdit}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
              color: '#888', padding: '4px 10px', borderRadius: 6, fontSize: 11,
              cursor: 'pointer', fontFamily: 'var(--font-mono)',
            }}
          >
            <Pencil size={10} /> Edit <span style={{ color: '#555' }}>(e)</span>
          </button>
          <button
            onClick={onApprove}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              background: 'rgba(0,255,136,0.1)', border: '1px solid rgba(0,255,136,0.3)',
              color: '#00ff88', padding: '4px 10px', borderRadius: 6, fontSize: 11,
              cursor: 'pointer', fontFamily: 'var(--font-mono)',
            }}
          >
            <Check size={10} /> Approve <span style={{ color: 'rgba(0,255,136,0.5)' }}>(↵)</span>
          </button>
          <button
            onClick={onReject}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
              color: '#ef4444', padding: '4px 10px', borderRadius: 6, fontSize: 11,
              cursor: 'pointer', fontFamily: 'var(--font-mono)',
            }}
          >
            <X size={10} /> Reject <span style={{ color: 'rgba(239,68,68,0.5)' }}>(esc)</span>
          </button>
        </div>
      )}
    </div>
  );
}
