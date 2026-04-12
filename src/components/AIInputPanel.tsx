import { useState, useRef, useEffect } from 'react';
import { Send, X } from 'lucide-react';

interface AIInputPanelProps {
  visible: boolean;
  onSubmit: (message: string) => void;
  onClose: () => void;
  initialValue?: string;
}

export function AIInputPanel({ visible, onSubmit, onClose, initialValue }: AIInputPanelProps) {
  const [value, setValue] = useState(initialValue || '');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (visible) {
      setValue(initialValue || '');
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [visible, initialValue]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (value.trim()) {
        onSubmit(value.trim());
        setValue('');
      }
    }
  };

  if (!visible) return null;

  return (
    <div style={{
      padding: '8px 12px',
      borderTop: '1px solid rgba(168, 85, 247, 0.2)',
      background: 'rgba(168, 85, 247, 0.04)',
      animation: 'fadeIn 0.15s ease',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
        padding: '8px 12px',
        background: 'rgba(168, 85, 247, 0.05)',
        border: '1px solid rgba(168, 85, 247, 0.2)',
        borderRadius: 8,
      }}>
        <span style={{ color: '#a855f7', marginTop: 4 }}>✦</span>
        <textarea
          ref={textareaRef}
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask AI anything..."
          rows={1}
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            color: 'var(--text-primary)',
            fontFamily: 'var(--font-mono)',
            fontSize: 13,
            lineHeight: 1.5,
            resize: 'vertical',
            outline: 'none',
            minHeight: 24,
            maxHeight: 200,
          }}
        />
        <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
          <button
            onClick={() => { if (value.trim()) { onSubmit(value.trim()); setValue(''); } }}
            style={{
              background: 'rgba(168,85,247,0.1)', border: '1px solid rgba(168,85,247,0.3)',
              color: '#a855f7', padding: '4px 6px', borderRadius: 6,
              cursor: 'pointer', display: 'flex',
            }}
          >
            <Send size={14} />
          </button>
          <button
            onClick={onClose}
            style={{
              background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
              color: '#888', padding: '4px 6px', borderRadius: 6,
              cursor: 'pointer', display: 'flex',
            }}
          >
            <X size={14} />
          </button>
        </div>
      </div>
      <div style={{ fontSize: 10, color: '#555', marginTop: 4, textAlign: 'right' }}>
        Enter to send · Shift+Enter for newline · Esc to close
      </div>
    </div>
  );
}
