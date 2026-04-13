import { Terminal, Sparkles, Globe } from 'lucide-react';
import type { ContextMode } from '@/types';
import styles from './TrustBadge.module.css';

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
    <div
      className={styles.badge}
      style={{
        border: `1px solid ${color}33`,
        color,
        background: `${color}11`,
      }}
    >
      <Icon size={10} />
      {label}
    </div>
  );
}
