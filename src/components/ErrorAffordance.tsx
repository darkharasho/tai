import { Sparkles } from 'lucide-react';
import type { SegmentedBlock } from '@/types';

interface ErrorAffordanceProps {
  block: SegmentedBlock;
  onAskAI: (block: SegmentedBlock) => void;
}

export function ErrorAffordance({ block, onAskAI }: ErrorAffordanceProps) {
  return (
    <div
      onClick={() => onAskAI(block)}
      style={{
        margin: '4px 0 8px',
        padding: '8px 12px',
        background: 'rgba(168, 85, 247, 0.05)',
        border: '1px solid rgba(168, 85, 247, 0.15)',
        borderRadius: 8,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        cursor: 'pointer',
        animation: 'fadeIn 0.2s ease',
      }}
    >
      <Sparkles size={14} color="#a855f7" />
      <span style={{ color: '#999', fontSize: 12 }}>Error detected — want me to fix it?</span>
    </div>
  );
}
