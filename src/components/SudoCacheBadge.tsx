// src/components/SudoCacheBadge.tsx
import { useEffect, useState } from 'react';

interface SudoCacheBadgeProps {
  cached: boolean;
  flash: boolean;        // briefly true right after an auto-fill
  onForget: () => void;
}

export function SudoCacheBadge({ cached, flash, onForget }: SudoCacheBadgeProps) {
  const [hover, setHover] = useState(false);
  if (!cached) return null;
  const label = flash ? '\u{1F513} sudo authenticated' : (hover ? '\u{1F513} forget sudo' : '\u{1F512} sudo cached');
  return (
    <button
      onClick={onForget}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title="Forget cached sudo password"
      style={{
        position: 'absolute',
        bottom: 10,
        right: 28,
        zIndex: 20,
        padding: '3px 9px',
        borderRadius: 999,
        border: '1px solid rgba(234, 179, 8, 0.3)',
        background: 'var(--bg-card)',
        color: 'var(--text-muted)',
        fontFamily: 'var(--font-mono)',
        fontSize: 10,
        cursor: 'pointer',
        opacity: flash ? 1 : 0.7,
        transition: 'opacity 120ms ease',
      }}
    >
      {label}
    </button>
  );
}

/** Convenience hook: subscribe to vault state + auto-auth flashes for one PTY. */
export function useSudoCacheState(ptyId: number | null) {
  const [cached, setCached] = useState(false);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    const offState = window.tai?.pty?.onSecretState?.((c) => setCached(c));
    let timer: ReturnType<typeof setTimeout> | null = null;
    const offAuth = window.tai?.pty?.onAutoAuth?.((id) => {
      if (ptyId !== null && id !== ptyId) return;
      setFlash(true);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setFlash(false), 1500);
    });
    return () => {
      offState?.();
      offAuth?.();
      if (timer) clearTimeout(timer);
    };
  }, [ptyId]);

  return { cached, flash };
}
