import { Terminal, Sparkles } from 'lucide-react';
import type { ContextMode } from '@/types';

interface TrustBadgeProps {
  level: string;
  modeColor?: string;
  contextMode?: ContextMode;
}

export function TrustBadge({ modeColor, contextMode = 'shell' }: TrustBadgeProps) {
  const isShell = contextMode === 'shell';
  const color = modeColor ?? (isShell ? 'var(--color-shell)' : 'var(--color-ai)');
  const Icon = isShell ? Terminal : Sparkles;
  const label = isShell ? 'Term' : 'AI';

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 4,
      padding: '2px 8px',
      borderRadius: 4,
      border: `1px solid ${color}33`,
      fontSize: 10,
      color,
    }}>
      <Icon size={10} />
      {label}
    </div>
  );
}
