export default function App() {
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
      }}>
        <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>tai</span>
      </div>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ color: 'var(--text-muted)' }}>Terminal loading...</span>
      </div>
    </div>
  );
}
