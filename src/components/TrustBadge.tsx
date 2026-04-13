import { Terminal, Sparkles, Globe } from 'lucide-react';
import type { ContextMode } from '@/types';

interface TrustBadgeProps {
  level: string;
  modeColor?: string;
  contextMode?: ContextMode;
  isRemote?: boolean;
}

export function TrustBadge({ modeColor, contextMode = 'shell', isRemote }: TrustBadgeProps) {
  let color: string;
  let Icon: typeof Terminal;
  let label: string;

  if (isRemote) {
    color = modeColor ?? 'var(--color-agent)';
    Icon = Globe;
    label = 'SSH';
  } else if (contextMode === 'shell') {
    color = modeColor ?? 'var(--color-shell)';
    Icon = Terminal;
    label = 'Term';
  } else {
    color = modeColor ?? 'var(--color-ai)';
    Icon = Sparkles;
    label = 'AI';
  }

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
