import { useState } from 'react';
import { ChevronDown, ChevronRight, Zap, Check, X, Loader2 } from 'lucide-react';
import type { AgentStep } from '@/types';

interface AgentStepCardProps {
  id: string;
  question: string;
  steps: AgentStep[];
  streaming: boolean;
}

const STATUS_ICON: Record<AgentStep['status'], React.ReactNode> = {
  pending: <span style={{ color: '#555' }}>○</span>,
  running: <Loader2 size={12} color="#fb923c" style={{ animation: 'spin 0.8s linear infinite' }} />,
  complete: <Check size={12} color="#00ff88" />,
  failed: <X size={12} color="#ef4444" />,
};

export function AgentStepCard({ question, steps, streaming }: AgentStepCardProps) {
  const [collapsed, setCollapsed] = useState(false);
  const completedCount = steps.filter(s => s.status === 'complete').length;

  return (
    <div style={{
      margin: '8px 0',
      borderLeft: '2px solid rgba(251, 146, 60, 0.4)',
      borderRadius: '0 8px 8px 0',
      background: 'rgba(251, 146, 60, 0.04)',
      overflow: 'hidden',
      animation: 'fadeIn 0.2s ease',
    }}>
      <div
        onClick={() => setCollapsed(!collapsed)}
        style={{
          padding: '10px 14px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          cursor: 'pointer',
        }}
      >
        {collapsed ? <ChevronRight size={14} color="#fb923c" /> : <ChevronDown size={14} color="#fb923c" />}
        <Zap size={14} color="#fb923c" />
        <span style={{ color: '#e0e0e0', fontSize: 12 }}>{question}</span>
        <span style={{ color: '#888', fontSize: 11, marginLeft: 'auto' }}>
          {completedCount}/{steps.length}
        </span>
        {streaming && (
          <span style={{
            width: 6, height: 6, borderRadius: '50%',
            background: '#fb923c',
            animation: 'pulse 1.5s infinite',
          }} />
        )}
      </div>

      {!collapsed && (
        <div style={{ padding: '0 14px 12px' }}>
          {steps.map((step, i) => (
            <div key={i} style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
              padding: '4px 0',
            }}>
              <span style={{ marginTop: 2 }}>{STATUS_ICON[step.status]}</span>
              <div style={{ flex: 1 }}>
                <span style={{
                  color: step.status === 'complete' ? '#666' : step.status === 'running' ? '#e0e0e0' : '#555',
                  fontSize: 12,
                  textDecoration: step.status === 'complete' ? 'line-through' : 'none',
                }}>
                  {step.description}
                </span>
                {step.status === 'running' && step.output && (
                  <div style={{
                    marginTop: 4, padding: '6px 8px',
                    background: 'rgba(0,0,0,0.3)', borderRadius: 4,
                    fontSize: 11, color: '#888', maxHeight: 120, overflow: 'auto',
                    fontFamily: 'var(--font-mono)',
                  }}>
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
