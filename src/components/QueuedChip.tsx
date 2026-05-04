import { useEffect, useRef, useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import styles from './QueuedChip.module.css';

interface QueuedChipProps {
  text: string;
  onSave: (text: string) => void;
  onRemove: () => void;
}

export function QueuedChip({ text, onSave, onRemove }: QueuedChipProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  useEffect(() => {
    if (!isEditing) setDraft(text);
  }, [text, isEditing]);

  const commit = () => {
    setIsEditing(false);
    if (draft !== text) onSave(draft);
  };

  const cancel = () => {
    setDraft(text);
    setIsEditing(false);
  };

  return (
    <span className={styles.chip}>
      <Sparkles size={11} className={styles.icon} />
      {isEditing ? (
        <input
          ref={inputRef}
          className={styles.input}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              cancel();
            }
          }}
        />
      ) : (
        <span
          className={styles.text}
          onClick={() => setIsEditing(true)}
          role="button"
          tabIndex={0}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setIsEditing(true);
            }
          }}
        >
          {text}
        </span>
      )}
      <button
        type="button"
        className={styles.remove}
        onClick={onRemove}
        aria-label="Remove queued message"
      >
        <X size={11} />
      </button>
    </span>
  );
}
