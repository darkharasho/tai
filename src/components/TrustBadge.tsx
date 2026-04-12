import { Shield, ShieldCheck, ShieldOff } from 'lucide-react';
import type { TrustLevel } from '@/types';

const TRUST_CONFIG: Record<TrustLevel, { label: string; color: string; Icon: typeof Shield }> = {
  ask: { label: 'Ask', color: 'var(--color-shell)', Icon: Shield },
  'approve-edits': { label: 'Approve Edits', color: 'var(--color-warning)', Icon: ShieldCheck },
  bypass: { label: 'Bypass', color: 'var(--color-error)', Icon: ShieldOff },
};

interface TrustBadgeProps {
  level: TrustLevel;
}

export function TrustBadge({ level }: TrustBadgeProps) {
  const { label, color, Icon } = TRUST_CONFIG[level];

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
