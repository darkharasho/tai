import { useState, useRef, useEffect } from 'react';
import { Settings, X, ChevronDown, Check, RefreshCw } from 'lucide-react';
import type { TrustLevel, AIProvider } from '@/types';
import { Toggle } from './Toggle';
import styles from './QuickSettings.module.css';

interface QuickSettingsProps {
  visible: boolean;
  onClose: () => void;
  colorMode: string;
  onColorModeChange: (mode: string) => void;
  cardAccent: string;
  onCardAccentChange: (value: string) => void;
  noise: boolean;
  onNoiseChange: (value: boolean) => void;
  trustLevel: TrustLevel;
  onTrustLevelChange: (level: TrustLevel) => void;
  aiProvider: AIProvider;
  onAIProviderChange: (provider: AIProvider) => void;
  claudeModel: string;
  onClaudeModelChange: (model: string) => void;
  claudeEffort: string;
  onClaudeEffortChange: (effort: string) => void;
  expandToolCalls: boolean;
  onExpandToolCallsChange: (value: boolean) => void;
  systemNotifications: boolean;
  onSystemNotificationsChange: (value: boolean) => void;
}

type Category = 'general' | 'claude';

const COLOR_MODE_OPTIONS = [
  { value: 'high', label: 'High' },
  { value: 'low', label: 'Low' },
];

const CARD_ACCENT_OPTIONS = [
  { value: 'brackets', label: 'Corner Brackets' },
  { value: 'stripe-left', label: 'Left Stripe' },
  { value: 'stripe-top', label: 'Top Stripe' },
  { value: 'tinted', label: 'Tinted Border' },
  { value: 'tinted-stripe', label: 'Tinted + Stripe' },
  { value: 'stripe-glow', label: 'Stripe + Glow' },
];

const TRUST_LEVEL_OPTIONS = [
  { value: 'ask', label: 'Ask Every Time' },
  { value: 'approve-edits', label: 'Auto-approve Edits' },
  { value: 'bypass', label: 'Full Auto' },
];

const PROVIDER_OPTIONS = [
  { value: 'claude', label: 'Claude' },
  { value: 'codex', label: 'Codex' },
  { value: 'gemini', label: 'Gemini' },
];

const CLAUDE_MODEL_OPTIONS = [
  { value: 'default', label: 'Default' },
  { value: 'best', label: 'Best' },
  { value: 'opus', label: 'Opus' },
  { value: 'opus[1m]', label: 'Opus (1M context)' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'sonnet[1m]', label: 'Sonnet (1M context)' },
  { value: 'haiku', label: 'Haiku' },
  { value: 'opusplan', label: 'Opus Plan' },
];

const CLAUDE_EFFORT_OPTIONS = [
  { value: 'auto', label: 'Default' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'max', label: 'Max (Opus only)' },
];

function CustomDropdown({ value, options, onChange }: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const selected = options.find(o => o.value === value);

  return (
    <div ref={ref} className={styles.dropdownWrapper}>
      <div
        onClick={() => setOpen(v => !v)}
        className={`${styles.dropdownTrigger} ${open ? styles.dropdownTriggerOpen : ''}`}
      >
        <span className={styles.dropdownValue}>{selected?.label}</span>
        <ChevronDown size={12} className={`${styles.dropdownChevron} ${open ? styles.dropdownChevronOpen : ''}`} />
      </div>
      {open && (
        <div className={styles.dropdownMenu}>
          {options.map(opt => (
            <div
              key={opt.value}
              className={`${styles.dropdownOption} ${opt.value === value ? styles.dropdownOptionActive : ''}`}
              onClick={() => { onChange(opt.value); setOpen(false); }}
            >
              <span className={styles.dropdownCheck}>
                {opt.value === value && <Check size={12} />}
              </span>
              {opt.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function QuickSettings({ visible, onClose, colorMode, onColorModeChange, cardAccent, onCardAccentChange, noise, onNoiseChange, trustLevel, onTrustLevelChange, aiProvider, onAIProviderChange, claudeModel, onClaudeModelChange, claudeEffort, onClaudeEffortChange, expandToolCalls, onExpandToolCallsChange, systemNotifications, onSystemNotificationsChange }: QuickSettingsProps) {
  const [category, setCategory] = useState<Category>('general');
  const [version, setVersion] = useState('');
  const [updateStatus, setUpdateStatus] = useState<'idle' | 'checking' | 'up-to-date' | 'available' | 'error'>('idle');

  useEffect(() => {
    if (visible) {
      window.tai?.update?.getVersion().then(v => setVersion(v));
      setUpdateStatus('idle');
    }
  }, [visible]);

  const handleCheckUpdate = () => {
    setUpdateStatus('checking');
    const cleanups: (() => void)[] = [];
    cleanups.push(window.tai?.update?.onStatus((status: string) => {
      if (status === 'up-to-date') { setUpdateStatus('up-to-date'); cleanups.forEach(c => c()); }
    }));
    cleanups.push(window.tai?.update?.onAvailable(() => {
      setUpdateStatus('available'); cleanups.forEach(c => c());
    }));
    cleanups.push(window.tai?.update?.onError(() => {
      setUpdateStatus('error'); cleanups.forEach(c => c());
    }));
    window.tai?.update?.check();
  };

  if (!visible) return null;

  const categories: { id: Category; label: string }[] = [
    { id: 'general', label: 'General' },
    { id: 'claude', label: 'Claude' },
  ];

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <Settings size={14} color="var(--text-secondary)" />
          <span className={styles.headerTitle}>Quick Settings</span>
          <X size={14} className={styles.closeBtn} onClick={onClose} />
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
              <>
                <div className={styles.settingRow}>
                  <span className={styles.settingLabel}>AI Provider</span>
                  <CustomDropdown
                    value={aiProvider}
                    options={PROVIDER_OPTIONS}
                    onChange={(v) => onAIProviderChange(v as AIProvider)}
                  />
                </div>
                <div className={styles.settingRow}>
                  <span className={styles.settingLabel}>AI Permissions</span>
                  <CustomDropdown
                    value={trustLevel}
                    options={TRUST_LEVEL_OPTIONS}
                    onChange={(v) => onTrustLevelChange(v as TrustLevel)}
                  />
                </div>
                <div className={styles.settingRow}>
                  <span className={styles.settingLabel}>Color Mode</span>
                  <CustomDropdown
                    value={colorMode}
                    options={COLOR_MODE_OPTIONS}
                    onChange={onColorModeChange}
                  />
                </div>
                <div className={styles.settingRow}>
                  <span className={styles.settingLabel}>Card Accent</span>
                  <CustomDropdown
                    value={cardAccent}
                    options={CARD_ACCENT_OPTIONS}
                    onChange={onCardAccentChange}
                  />
                </div>
                <div className={styles.settingRow}>
                  <span className={styles.settingLabel}>Noise Texture</span>
                  <Toggle checked={noise} onChange={onNoiseChange} ariaLabel="Noise texture" />
                </div>

                <div className={styles.settingRow}>
                  <span className={styles.settingLabel}>Expand Tool Calls</span>
                  <Toggle checked={expandToolCalls} onChange={onExpandToolCallsChange} ariaLabel="Expand tool calls" />
                </div>

                <div className={styles.settingRow}>
                  <span className={styles.settingLabel}>Notify on Completion</span>
                  <Toggle checked={systemNotifications} onChange={onSystemNotificationsChange} ariaLabel="Notify on completion" />
                </div>

                <div className={styles.settingRow}>
                  <span className={styles.settingLabel}>Version</span>
                  <div className={styles.versionRow}>
                    <span className={styles.versionValue}>{version || '…'}</span>
                    <button
                      className={styles.updateBtn}
                      onClick={handleCheckUpdate}
                      disabled={updateStatus === 'checking'}
                    >
                      <RefreshCw size={11} className={updateStatus === 'checking' ? styles.spinning : ''} />
                      {updateStatus === 'idle' && 'Check for Updates'}
                      {updateStatus === 'checking' && 'Checking…'}
                      {updateStatus === 'up-to-date' && 'Up to Date'}
                      {updateStatus === 'available' && 'Update Available!'}
                      {updateStatus === 'error' && 'Check Failed'}
                    </button>
                  </div>
                </div>
              </>
            )}
            {category === 'claude' && (
              <>
                <div className={styles.settingRow}>
                  <span className={styles.settingLabel}>Model</span>
                  <CustomDropdown
                    value={claudeModel}
                    options={CLAUDE_MODEL_OPTIONS}
                    onChange={onClaudeModelChange}
                  />
                </div>
                <div className={styles.settingRow}>
                  <span className={styles.settingLabel}>Reasoning Effort</span>
                  <CustomDropdown
                    value={claudeEffort}
                    options={CLAUDE_EFFORT_OPTIONS}
                    onChange={onClaudeEffortChange}
                  />
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
