import { useState } from 'react';
import { ChevronDown, ChevronRight, Zap, Check, X, Loader2 } from 'lucide-react';
import type { AgentStep } from '@/types';
import styles from './AgentStepCard.module.css';

interface AgentStepCardProps {
  id: string;
  question: string;
  steps: AgentStep[];
  streaming: boolean;
}

const STATUS_GLOW: Record<AgentStep['status'], string | undefined> = {
  pending:  undefined,
  running:  '0 0 6px rgba(251, 146, 60, 0.7)',
  complete: '0 0 6px rgba(0, 255, 136, 0.6)',
  failed:   '0 0 6px rgba(239, 68, 68, 0.7)',
};

function StatusIcon({ status }: { status: AgentStep['status'] }) {
  const glow = STATUS_GLOW[status];
  const iconStyle = glow ? { boxShadow: glow, borderRadius: '50%' } : undefined;

  if (status === 'pending')  return <span style={{ color: '#555' }}>○</span>;
  if (status === 'running')  return <Loader2  size={12} color="#fb923c" style={{ animation: 'spin 0.8s linear infinite', ...iconStyle }} />;
  if (status === 'complete') return <Check    size={12} color="#00ff88" style={iconStyle} />;
  if (status === 'failed')   return <X        size={12} color="#ef4444" style={iconStyle} />;
  return null;
}

export function AgentStepCard({ question, steps, streaming }: AgentStepCardProps) {
  const [collapsed, setCollapsed] = useState(false);
  const completedCount = steps.filter(s => s.status === 'complete').length;

  return (
    <div className={styles.card} data-card-surface>
      <div className={styles.header} onClick={() => setCollapsed(!collapsed)}>
        {collapsed
          ? <ChevronRight size={14} color="var(--color-agent)" />
          : <ChevronDown  size={14} color="var(--color-agent)" />
        }
        <Zap size={14} color="var(--color-agent)" />
        <span className={styles.question}>{question}</span>
        <span className={styles.progress}>{completedCount}/{steps.length}</span>
        {streaming && <span className={styles.streamingDot} />}
      </div>

      {!collapsed && (
        <div className={styles.steps}>
          {steps.map((step, i) => (
            <div key={i} className={styles.step}>
              <span className={styles.stepIconWrap}>
                <StatusIcon status={step.status} />
              </span>
              <div className={styles.stepBody}>
                <span className={`${styles.stepLabel} ${styles[`stepLabel--${step.status}`]}`}>
                  {step.description}
                </span>
                {step.status === 'running' && step.output && (
                  <div className={styles.stepOutput}>
                    {step.output}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
