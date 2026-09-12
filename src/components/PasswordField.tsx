import { useState, useRef, useEffect } from 'react';
import { Toggle } from './Toggle';

interface PasswordFieldProps {
  /** Called per typed character (the terminal forwards keystrokes live). */
  onChar?: (c: string) => void;
  /** Called per deleted character, only when there was one to delete. */
  onBackspace?: () => void;
  onSubmit: (secret: string, remember: boolean) => void;
  onCancel: () => void;
  cancelOnEscape?: boolean;
  /**
   * Don't grab focus on mount while the user is typing elsewhere (focus in a
   * text field that already holds text): a following Enter would submit that
   * text as the password. The caller's attention UI + click takes over instead.
   */
  yieldToTyping?: boolean;
}

/** True when focus sits in an editable element that already holds typed text. */
function userIsTypingElsewhere(): boolean {
  const el = typeof document !== 'undefined' ? document.activeElement : null;
  if (!(el instanceof HTMLElement)) return false;
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) return el.value.length > 0;
  if (el.isContentEditable) return (el.textContent ?? '').length > 0;
  return false;
}

/** The shared password input: masked dots, Remember toggle, keyboard handling. */
export function PasswordField({ onChar, onBackspace, onSubmit, onCancel, cancelOnEscape, yieldToTyping }: PasswordFieldProps) {
  const [dots, setDots] = useState(0);
  const [remember, setRemember] = useState(false);
  const secretRef = useRef('');
  const rememberRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => { rememberRef.current = remember; }, [remember]);
  useEffect(() => {
    if (yieldToTyping && userIsTypingElsewhere()) return;
    containerRef.current?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Enter') {
      const secret = secretRef.current;
      secretRef.current = '';
      setDots(0);
      onSubmit(secret, rememberRef.current);
    } else if (e.key === 'Backspace') {
      if (secretRef.current.length > 0) {
        secretRef.current = secretRef.current.slice(0, -1);
        setDots(d => d - 1);
        onBackspace?.();
      }
    } else if ((e.key === 'c' && e.ctrlKey) || (cancelOnEscape && e.key === 'Escape')) {
      secretRef.current = '';
      setDots(0);
      onCancel();
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      secretRef.current += e.key;
      setDots(d => d + 1);
      onChar?.(e.key);
    }
  };

  return (
    <div
      ref={containerRef}
      data-testid="password-field"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      style={{
        margin: '0 14px 4px',
        padding: '10px 16px',
        background: 'var(--bg-card)',
        border: '1px solid rgba(234, 179, 8, 0.2)',
        borderRadius: 'var(--r-lg)',
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
