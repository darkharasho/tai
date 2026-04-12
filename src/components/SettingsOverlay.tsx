import { useState } from 'react';
import { X, Settings } from 'lucide-react';

interface SettingsOverlayProps {
  visible: boolean;
  onClose: () => void;
  config: Record<string, any>;
  onSet: (key: string, value: any) => void;
}

type Category = 'general' | 'ai' | 'trust' | 'appearance' | 'keybindings';

export function SettingsOverlay({ visible, onClose, config, onSet }: SettingsOverlayProps) {
  const [category, setCategory] = useState<Category>('general');

  if (!visible) return null;

  const categories: { id: Category; label: string }[] = [
    { id: 'general', label: 'General' },
    { id: 'ai', label: 'AI Provider' },
    { id: 'trust', label: 'Trust' },
    { id: 'appearance', label: 'Appearance' },
    { id: 'keybindings', label: 'Keybindings' },
  ];

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 600, maxHeight: '80vh', background: '#0e0e1a',
          border: '1px solid var(--border-subtle)',
          borderRadius: 12, overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
          animation: 'fadeIn 0.15s ease',
        }}
      >
        <div style={{
          padding: '14px 16px',
          display: 'flex', alignItems: 'center', gap: 8,
          borderBottom: '1px solid var(--border-subtle)',
        }}>
          <Settings size={16} color="var(--text-secondary)" />
          <span style={{ fontSize: 14, color: 'var(--text-primary)', flex: 1 }}>Settings</span>
          <X size={16} color="var(--text-muted)" style={{ cursor: 'pointer' }} onClick={onClose} />
        </div>

        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          <div style={{
            width: 160, borderRight: '1px solid var(--border-subtle)',
            padding: '8px 0',
          }}>
            {categories.map(cat => (
              <div
                key={cat.id}
                onClick={() => setCategory(cat.id)}
                style={{
                  padding: '8px 16px', cursor: 'pointer',
                  fontSize: 12,
                  color: category === cat.id ? 'var(--text-primary)' : 'var(--text-secondary)',
                  background: category === cat.id ? 'rgba(255,255,255,0.05)' : 'transparent',
                }}
              >
                {cat.label}
              </div>
            ))}
          </div>

          <div style={{ flex: 1, padding: 16, overflow: 'auto' }}>
            {category === 'general' && (
              <SettingsGroup>
                <SettingRow label="Font Size" value={
                  <input type="number" value={config['general.fontSize']} onChange={e => onSet('general.fontSize', parseInt(e.target.value))}
                    style={inputStyle} />
                } />
                <SettingRow label="Cursor Style" value={
                  <select value={config['general.cursorStyle']} onChange={e => onSet('general.cursorStyle', e.target.value)}
                    style={inputStyle}>
                    <option value="bar">Bar</option>
                    <option value="block">Block</option>
                    <option value="underline">Underline</option>
                  </select>
                } />
              </SettingsGroup>
            )}
            {category === 'ai' && (
              <SettingsGroup>
                <SettingRow label="Provider" value={
                  <select value={config['ai.provider']} onChange={e => onSet('ai.provider', e.target.value)}
                    style={inputStyle}>
                    <option value="claude">Claude</option>
                  </select>
                } />
                <SettingRow label="Model" value={
                  <input type="text" value={config['ai.model']} onChange={e => onSet('ai.model', e.target.value)}
                    style={inputStyle} />
                } />
              </SettingsGroup>
            )}
            {category === 'trust' && (
              <SettingsGroup>
                <SettingRow label="Default Trust Level" value={
                  <select value={config['trust.default']} onChange={e => onSet('trust.default', e.target.value)}
                    style={inputStyle}>
                    <option value="ask">Ask (approve everything)</option>
                    <option value="approve-edits">Approve Edits (read-only is free)</option>
                    <option value="bypass">Bypass (full autonomy)</option>
                  </select>
                } />
              </SettingsGroup>
            )}
            {category === 'appearance' && (
              <SettingsGroup>
                <SettingRow label="Gradient Border" value={
                  <input type="checkbox" checked={config['appearance.gradientBorder']}
                    onChange={e => onSet('appearance.gradientBorder', e.target.checked)} />
                } />
                <SettingRow label="Animation Speed (seconds)" value={
                  <input type="number" value={config['appearance.animationSpeed']}
                    onChange={e => onSet('appearance.animationSpeed', parseInt(e.target.value))}
                    style={inputStyle} />
                } />
              </SettingsGroup>
            )}
            {category === 'keybindings' && (
              <div style={{ color: 'var(--text-secondary)', fontSize: 12, padding: 16 }}>
                Keybinding customization coming soon.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SettingsGroup({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>{children}</div>;
}

function SettingRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{label}</span>
      {value}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 6,
  padding: '4px 8px',
  color: 'var(--text-primary)',
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
  outline: 'none',
  width: 160,
};
