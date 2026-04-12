import { Sparkles, Terminal } from 'lucide-react';

interface ModeIndicatorProps {
  mode: 'shell' | 'ai';
  transitioning?: boolean;
}

export function ModeIndicator({ mode, transitioning }: ModeIndicatorProps) {
  return (
    <div style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4,
      padding: '2px 6px',
      borderRadius: 4,
      fontSize: 11,
      transition: 'all 0.3s ease',
      opacity: transitioning ? 0.5 : 1,
    }}>
      {mode === 'shell' ? (
        <>
          <Terminal size={12} color="var(--color-shell)" />
          <span style={{ color: 'var(--color-shell)' }}>$</span>
        </>
      ) : (
        <>
          <Sparkles size={12} color="var(--color-ai)" />
          <span style={{ color: 'var(--color-ai)' }}>✦</span>
        </>
      )}
    </div>
  );
}
