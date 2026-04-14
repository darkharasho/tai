import { useState, useRef, useEffect } from 'react';

interface PasswordPromptProps {
  ptyId: number;
  onDone: () => void;
}

export function PasswordPrompt({ ptyId, onDone }: PasswordPromptProps) {
  const [dots, setDots] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    containerRef.current?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Enter') {
      window.tai?.pty?.write(ptyId, '\n');
      setDots(0);
      onDone();
    } else if (e.key === 'Backspace') {
      if (dots > 0) {
        setDots(d => d - 1);
        window.tai?.pty?.write(ptyId, '\x7f');
      }
    } else if (e.key === 'c' && e.ctrlKey) {
      window.tai?.pty?.write(ptyId, '\x03');
      setDots(0);
      onDone();
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      setDots(d => d + 1);
      window.tai?.pty?.write(ptyId, e.key);
    }
  };

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      style={{
        margin: '0 14px 4px',
        padding: '10px 16px',
        background: 'var(--bg-card)',
        border: '1px solid rgba(234, 179, 8, 0.2)',
        borderRadius: '10px',
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        fontFamily: 'var(--font-mono)',
        fontSize: '13px',
        outline: 'none',
        cursor: 'text',
      }}
    >
      <span style={{ color: '#eab308', fontSize: '14px', flexShrink: 0 }}>&#x1F512;</span>
      <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>Password:</span>
      <span style={{ color: 'var(--text-primary)', letterSpacing: '2px', minHeight: '18px', flex: 1 }}>
        {'•'.repeat(dots)}
        <span style={{ opacity: 0.5, animation: 'pulse 1s ease-in-out infinite' }}>|</span>
      </span>
      <span style={{ color: 'var(--text-muted)', fontSize: '10px', flexShrink: 0 }}>Enter to submit</span>
    </div>
  );
}
