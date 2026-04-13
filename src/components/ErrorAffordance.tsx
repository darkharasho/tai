import { Sparkles } from 'lucide-react';
import type { SegmentedBlock } from '@/types';
import styles from './ErrorAffordance.module.css';

interface ErrorAffordanceProps {
  block: SegmentedBlock;
  onAskAI: (block: SegmentedBlock) => void;
}

export function ErrorAffordance({ block, onAskAI }: ErrorAffordanceProps) {
  return (
    <div
      onClick={() => onAskAI(block)}
      className={styles.container}
    >
      <Sparkles size={14} color="var(--color-ai)" />
      <span>Error detected — want me to fix it?</span>
    </div>
  );
}
