import { useEffect } from 'react';
import { Check, Pencil, X } from 'lucide-react';
import styles from './ApprovalPrompt.module.css';

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
    <div className={styles.container} data-card-surface style={{ opacity: resolved ? 0.4 : 1 }}>
      <div className={styles.commandPreview}>
        <span className={styles.commandAccent}>❯</span> {command}
      </div>
      {!resolved && (
        <div className={styles.buttonRow}>
          <button onClick={onEdit} className={styles.button}>
            <Pencil size={10} /> Edit <span className={styles.keyHint}>(e)</span>
          </button>
          <button onClick={onApprove} className={styles.buttonApprove}>
            <Check size={10} /> Approve <span className={styles.keyHintApprove}>(↵)</span>
          </button>
          <button onClick={onReject} className={styles.buttonReject}>
            <X size={10} /> Reject <span className={styles.keyHintReject}>(esc)</span>
          </button>
        </div>
      )}
    </div>
  );
}
