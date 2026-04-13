import { type ReactNode, useEffect, useRef } from 'react';
import type { ContextMode } from '@/types';

const GRADIENT_COLORS: Record<ContextMode, { c1: string; c2: string; mid: string }> = {
  shell: { c1: '#00ff88', c2: '#00cc6a', mid: '#0a5c3a' },
  ai: { c1: '#a855f7', c2: '#7c3aed', mid: '#3b1a6e' },
  agent: { c1: '#fb923c', c2: '#ea580c', mid: '#6b2a0a' },
  error: { c1: '#ef4444', c2: '#dc2626', mid: '#6b1414' },
};

interface GradientBorderProps {
  mode: ContextMode;
  children: ReactNode;
}

export function GradientBorder({ mode, children }: GradientBorderProps) {
  const borderRef = useRef<HTMLDivElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const colors = GRADIENT_COLORS[mode];
    const gradient = `linear-gradient(135deg, ${colors.c1} 0%, ${colors.c2} 20%, ${colors.mid} 50%, ${colors.c2} 80%, ${colors.c1} 100%)`;
    const glowC1 = colors.c1.replace('#', '');
    const r = parseInt(glowC1.slice(0, 2), 16);
    const g = parseInt(glowC1.slice(2, 4), 16);
    const b = parseInt(glowC1.slice(4, 6), 16);
    const glowGradient = `linear-gradient(135deg, rgba(${r},${g},${b},0.15) 0%, rgba(${r},${g},${b},0.1) 20%, transparent 50%, rgba(${r},${g},${b},0.1) 80%, rgba(${r},${g},${b},0.15) 100%)`;

    if (borderRef.current) {
      borderRef.current.style.background = gradient;
      borderRef.current.style.backgroundSize = '300% 300%';
    }
    if (glowRef.current) {
      glowRef.current.style.background = glowGradient;
      glowRef.current.style.backgroundSize = '300% 300%';
    }
  }, [mode]);

  return (
    <div style={{ position: 'relative', height: '100vh', overflow: 'hidden' }}>
      <div
        ref={borderRef}
        style={{
          position: 'absolute',
          inset: 0,
          padding: 2,
          backgroundSize: '300% 300%',
          animation: 'gradient-sweep 20s ease-in-out infinite alternate',
          WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
          WebkitMaskComposite: 'xor',
          mask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
          maskComposite: 'exclude' as any,
          pointerEvents: 'none',
          zIndex: 10,
          opacity: 0.8,
          transition: 'background 1.5s ease',
        }}
      />
      <div
        ref={glowRef}
        style={{
          position: 'absolute',
          inset: 0,
          backgroundSize: '300% 300%',
          animation: 'gradient-sweep 20s ease-in-out infinite alternate',
          filter: 'blur(8px)',
          pointerEvents: 'none',
          zIndex: 9,
          opacity: 0.4,
          transition: 'background 1.5s ease',
        }}
      />
      <div style={{ position: 'relative', zIndex: 1, height: '100%', padding: 2, overflow: 'hidden' }}>
        {children}
      </div>
    </div>
  );
}
