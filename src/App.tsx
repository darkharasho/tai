import { useState, useEffect, useRef } from 'react';
import { XtermPane, XtermPaneHandle } from './components/XtermPane';

export default function App() {
  const [ptyId, setPtyId] = useState<number | null>(null);
  const xtermRef = useRef<XtermPaneHandle>(null);

  useEffect(() => {
    const cwd = process.env.HOME || '/';
    window.tai.pty.create(cwd).then((id) => {
      setPtyId(id);
    });

    return () => {
      if (ptyId !== null) window.tai.pty.kill(ptyId);
    };
  }, []);

  useEffect(() => {
    if (ptyId !== null) {
      setTimeout(() => xtermRef.current?.focus(), 100);
    }
  }, [ptyId]);

  return (
    <div style={{
      height: '100vh',
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--bg-base)',
    }}>
      <div style={{
        padding: '10px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        borderBottom: '1px solid var(--border-subtle)',
        ...({ WebkitAppRegion: 'drag' } as any),
        userSelect: 'none',
      }}>
        <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>tai</span>
      </div>
      <XtermPane ref={xtermRef} ptyId={ptyId} />
    </div>
  );
}
