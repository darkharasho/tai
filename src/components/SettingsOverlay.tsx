import { useState } from 'react';
import { X, Settings } from 'lucide-react';
import { Toggle } from './Toggle';
import { THEME_OPTIONS } from '@/theme/themes';
import styles from './SettingsOverlay.module.css';

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
    <div className={styles.overlay} onClick={onClose}>
      <div
        className={styles.modal}
        onClick={e => e.stopPropagation()}
      >
        <div className={styles.header}>
          <Settings size={16} color="var(--text-secondary)" />
          <span className={styles.headerTitle}>Settings</span>
          <X size={16} color="var(--text-muted)" className={styles.closeButton} onClick={onClose} />
        </div>

        <div className={styles.body}>
          <div className={styles.sidebar}>
            {categories.map(cat => (
              <div
                key={cat.id}
                onClick={() => setCategory(cat.id)}
                className={`${styles.sidebarItem} ${category === cat.id ? styles.sidebarItemActive : ''}`}
              >
                {cat.label}
              </div>
            ))}
          </div>

          <div className={styles.content}>
            {category === 'general' && (
              <SettingsGroup>
                <SettingRow label="Font Size" value={
                  <input type="number" value={config['general.fontSize']} onChange={e => onSet('general.fontSize', parseInt(e.target.value))}
                    className={styles.input} />
                } />
                <SettingRow label="Cursor Style" value={
                  <select value={config['general.cursorStyle']} onChange={e => onSet('general.cursorStyle', e.target.value)}
                    className={styles.input}>
                    <option value="bar">Bar</option>
                    <option value="block">Block</option>
                    <option value="underline">Underline</option>
                  </select>
                } />
                <SettingRow label="System notifications on completion" value={
                  <Toggle checked={!!config['systemNotifications']}
                    onChange={v => onSet('systemNotifications', v)} />
                } />
              </SettingsGroup>
            )}
            {category === 'ai' && (
              <SettingsGroup>
                <SettingRow label="Provider" value={
                  <select value={config['ai.provider']} onChange={e => onSet('ai.provider', e.target.value)}
                    className={styles.input}>
                    <option value="claude">Claude</option>
                    <option value="codex">Codex</option>
                    <option value="gemini">Gemini</option>
                  </select>
                } />
                <SettingRow label="Model" value={
                  <input type="text" value={config['ai.model']} onChange={e => onSet('ai.model', e.target.value)}
                    className={styles.input} />
                } />
                <SettingRow label="AI next-command suggestions" value={
                  <Toggle checked={!!config['aiNextCommandRefine']}
                    onChange={v => onSet('aiNextCommandRefine', v)} />
                } />
              </SettingsGroup>
            )}
            {category === 'trust' && (
              <SettingsGroup>
                <SettingRow label="Default Trust Level" value={
                  <select value={config['trust.default']} onChange={e => onSet('trust.default', e.target.value)}
                    className={styles.input}>
                    <option value="ask">Ask (approve everything)</option>
                    <option value="approve-edits">Approve Edits (read-only is free)</option>
                    <option value="bypass">Bypass (full autonomy)</option>
                  </select>
                } />
              </SettingsGroup>
            )}
            {category === 'appearance' && (
              <SettingsGroup>
                <SettingRow label="Theme" value={
                  <select value={config['appearance.theme'] || 'default'}
                    onChange={e => onSet('appearance.theme', e.target.value)}
                    className={styles.input}>
                    {THEME_OPTIONS.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                } />
                <SettingRow label="Expand tool calls by default" value={
                  <Toggle checked={!!config['ai.expandToolCalls']}
                    onChange={v => onSet('ai.expandToolCalls', v)} />
                } />
                <SettingRow label="Gradient Border" value={
                  <Toggle checked={!!config['appearance.gradientBorder']}
                    onChange={v => onSet('appearance.gradientBorder', v)} />
                } />
                <SettingRow label="Animation Speed (seconds)" value={
                  <input type="number" value={config['appearance.animationSpeed']}
                    onChange={e => onSet('appearance.animationSpeed', parseInt(e.target.value))}
                    className={styles.input} />
                } />
              </SettingsGroup>
            )}
            {category === 'keybindings' && (
              <div className={styles.keybindingsPlaceholder}>
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
  return <div className={styles.settingsGroup}>{children}</div>;
}

function SettingRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className={styles.settingRow}>
      <span className={styles.settingLabel}>{label}</span>
      {value}
    </div>
  );
}
