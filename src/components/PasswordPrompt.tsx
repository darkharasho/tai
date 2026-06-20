import { useState, useRef, useEffect } from 'react';
import { Toggle } from './Toggle';

interface PasswordPromptProps {
  ptyId: number;
  onDone: () => void;
}

export function PasswordPrompt({ ptyId, onDone }: PasswordPromptProps) {
  const [dots, setDots] = useState(0);
  const [remember, setRemember] = useState(false);
  const secretRef = useRef('');
  const rememberRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => { rememberRef.current = remember; }, [remember]);
  useEffect(() => { containerRef.current?.focus(); }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Enter') {
      if (rememberRef.current && secretRef.current.length > 0) {
        window.tai?.pty?.rememberSecret?.(secretRef.current);
      }
      secretRef.current = '';
      window.tai?.pty?.write(ptyId, '\n');
      setDots(0);
      onDone();
    } else if (e.key === 'Backspace') {
      if (dots > 0) {
        setDots(d => d - 1);
        secretRef.current = secretRef.current.slice(0, -1);
        window.tai?.pty?.write(ptyId, '\x7f');
      }
    } else if (e.key === 'c' && e.ctrlKey) {
      secretRef.current = '';
      window.tai?.pty?.write(ptyId, '\x03');
      setDots(0);
      onDone();
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      setDots(d => d + 1);
      secretRef.current += e.key;
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
      <span
        onKeyDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.preventDefault()} // keep keyboard focus on the password field
        style={{ display: 'flex', alignItems: 'center', gap: '7px', flexShrink: 0 }}
      >
        <span
          onClick={() => { setRemember(v => !v); containerRef.current?.focus(); }}
          style={{ color: 'var(--text-muted)', fontSize: '11px', cursor: 'pointer', userSelect: 'none' }}
        >
          Remember for this session
        </span>
        <Toggle
          checked={remember}
          onChange={(v) => { setRemember(v); containerRef.current?.focus(); }}
          ariaLabel="Remember sudo password for this session"
        />
      </span>
      <span style={{ color: 'var(--text-muted)', fontSize: '10px', flexShrink: 0 }}>Enter to submit</span>
    </div>
  );
}
