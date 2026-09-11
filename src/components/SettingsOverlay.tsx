import { useState, useRef, useEffect } from 'react';
import { X, Settings, ChevronDown, Check, RefreshCw } from 'lucide-react';
import type { TrustLevel, AIProvider } from '@/types';
import { Toggle } from './Toggle';
import { THEME_OPTIONS } from '@/theme/themes';
import styles from './Settings.module.css';

interface SettingsOverlayProps {
  visible: boolean;
  onClose: () => void;
  config: Record<string, any>;
  onSet: (key: string, value: any) => void;
  // Provider and permissions apply to the active tab as well as becoming the
  // default for new ones, so they go through App rather than onSet.
  trustLevel: TrustLevel;
  onTrustLevelChange: (level: TrustLevel) => void;
  aiProvider: AIProvider;
  onAIProviderChange: (provider: AIProvider) => void;
  availableModels?: { value: string; label: string; description?: string; recommended?: boolean }[];
}

type Category = 'general' | 'ai' | 'appearance' | 'workflows';

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

const CLOSE_ACTION_OPTIONS = [
  { value: 'tray', label: 'Keep running in the tray' },
  { value: 'quit', label: 'Quit' },
];

const CLAUDE_MODEL_OPTIONS = [
  { value: 'default', label: 'Default' },
  { value: 'best', label: 'Best' },
  { value: 'opus', label: 'Opus 4.8' },
  { value: 'opus[1m]', label: 'Opus 4.8 (1M context)' },
  { value: 'sonnet', label: 'Sonnet 4.6' },
  { value: 'sonnet[1m]', label: 'Sonnet 4.6 (1M context)' },
  { value: 'haiku', label: 'Haiku 4.5' },
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
        <ChevronDown size={13} className={`${styles.dropdownChevron} ${open ? styles.dropdownChevronOpen : ''}`} />
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
                {opt.value === value && <Check size={13} />}
              </span>
              {opt.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function SettingsOverlay({ visible, onClose, config, onSet, trustLevel, onTrustLevelChange, aiProvider, onAIProviderChange, availableModels }: SettingsOverlayProps) {
  const [category, setCategory] = useState<Category>('general');
  const [workflows, setWorkflowsState] = useState<Array<{id:string;name:string;command:string}>>([]);
  const [wfName, setWfName] = useState('');
  const [wfCommand, setWfCommand] = useState('');
  const [version, setVersion] = useState('');
  const [updateStatus, setUpdateStatus] = useState<'idle' | 'checking' | 'up-to-date' | 'available' | 'error'>('idle');

  const modelOptions = availableModels?.length ? availableModels : CLAUDE_MODEL_OPTIONS;

  useEffect(() => {
    if (visible) {
      window.tai?.update?.getVersion().then(v => setVersion(v));
      setUpdateStatus('idle');
    }
  }, [visible]);

  useEffect(() => {
    if (visible && category === 'workflows') {
      window.tai?.workflows?.get?.()?.then(list => setWorkflowsState(list ?? []));
    }
  }, [visible, category]);

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
    { id: 'ai', label: 'AI' },
    { id: 'appearance', label: 'Appearance' },
    { id: 'workflows', label: 'Workflows' },
  ];

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <Settings size={16} color="var(--text-secondary)" />
          <span className={styles.headerTitle}>Settings</span>
          <X size={16} className={styles.closeBtn} onClick={onClose} />
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
            <div className={styles.rows}>
              {category === 'general' && (
                <>
                  <SettingRow label="On Window Close" value={
                    <CustomDropdown
                      value={config['general.closeAction'] === 'quit' ? 'quit' : 'tray'}
                      options={CLOSE_ACTION_OPTIONS}
                      onChange={v => onSet('general.closeAction', v)}
                    />
                  } />
                  <SettingRow label="Notify on Completion" value={
                    <Toggle checked={!!config['systemNotifications']}
                      onChange={v => onSet('systemNotifications', v)} ariaLabel="Notify on completion" />
                  } />
                  <SettingRow label="Version" value={
                    <div className={styles.versionRow}>
                      <span className={styles.versionValue}>{version || '…'}</span>
                      <button
                        className={styles.button}
                        onClick={handleCheckUpdate}
                        disabled={updateStatus === 'checking'}
                      >
                        <RefreshCw size={12} className={updateStatus === 'checking' ? styles.spinning : ''} />
                        {updateStatus === 'idle' && 'Check for Updates'}
                        {updateStatus === 'checking' && 'Checking…'}
                        {updateStatus === 'up-to-date' && 'Up to Date'}
                        {updateStatus === 'available' && 'Update Available!'}
                        {updateStatus === 'error' && 'Check Failed'}
                      </button>
                    </div>
                  } />
                </>
              )}
              {category === 'ai' && (
                <>
                  <SettingRow label="AI Provider" value={
                    <CustomDropdown value={aiProvider} options={PROVIDER_OPTIONS}
                      onChange={v => onAIProviderChange(v as AIProvider)} />
                  } />
                  <SettingRow label="AI Permissions" value={
                    <CustomDropdown value={trustLevel} options={TRUST_LEVEL_OPTIONS}
                      onChange={v => onTrustLevelChange(v as TrustLevel)} />
                  } />
                  <SettingRow label="Expand Tool Calls" value={
                    <Toggle checked={!!config['ai.expandToolCalls']}
                      onChange={v => onSet('ai.expandToolCalls', v)} ariaLabel="Expand tool calls" />
                  } />
                  <div className={styles.sectionTitle}>Claude</div>
                  <SettingRow label="Model" value={
                    <CustomDropdown value={config['claude.model'] || 'sonnet'} options={modelOptions}
                      onChange={v => onSet('claude.model', v)} />
                  } />
                  <SettingRow label="Reasoning Effort" value={
                    <CustomDropdown value={config['claude.effort'] || 'auto'} options={CLAUDE_EFFORT_OPTIONS}
                      onChange={v => onSet('claude.effort', v)} />
                  } />
                  <SettingRow label="Show Reasoning" value={
                    <Toggle checked={config['claude.showReasoning'] !== false}
                      onChange={v => onSet('claude.showReasoning', v)} ariaLabel="Show reasoning" />
                  } />
                </>
              )}
              {category === 'appearance' && (
                <>
                  <SettingRow label="Theme" value={
                    <CustomDropdown value={config['appearance.theme'] || 'default'} options={THEME_OPTIONS}
                      onChange={v => onSet('appearance.theme', v)} />
                  } />
                  <SettingRow label="Color Mode" value={
                    <CustomDropdown value={config['appearance.colorMode'] || 'high'} options={COLOR_MODE_OPTIONS}
                      onChange={v => onSet('appearance.colorMode', v)} />
                  } />
                  <SettingRow label="Card Accent" value={
                    <CustomDropdown value={config['appearance.cardAccent'] || 'brackets'} options={CARD_ACCENT_OPTIONS}
                      onChange={v => onSet('appearance.cardAccent', v)} />
                  } />
                  <SettingRow label="Noise Texture" value={
                    <Toggle checked={config['appearance.noise'] !== false}
                      onChange={v => onSet('appearance.noise', v)} ariaLabel="Noise texture" />
                  } />
                </>
              )}
              {category === 'workflows' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {workflows.map(wf => (
                      <div key={wf.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 14, color: 'var(--text-primary)', fontFamily: 'var(--font-sans)', fontWeight: 500 }}>{wf.name}</div>
                          <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{wf.command}</div>
                        </div>
                        <button className={styles.button} onClick={() => {
                          const updated = workflows.filter(w => w.id !== wf.id);
                          setWorkflowsState(updated);
                          try { (window as any).tai?.workflows?.set?.(updated); } catch {}
                        }}>
                          Delete
                        </button>
                      </div>
                    ))}
                    {workflows.length === 0 && (
                      <div style={{ fontSize: 13, color: 'var(--text-muted)', fontFamily: 'var(--font-sans)', padding: '8px 0' }}>No workflows yet.</div>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div className={styles.sectionTitle}>Add workflow</div>
                    <input className={styles.input} placeholder="Name" value={wfName} onChange={e => setWfName(e.target.value)} />
                    <input className={styles.input} placeholder="Command (use {{param}} for params)" value={wfCommand} onChange={e => setWfCommand(e.target.value)} />
                    <button className={styles.button} style={{ alignSelf: 'flex-start' }} onClick={() => {
                      if (!wfName.trim() || !wfCommand.trim()) return;
                      const updated = [...workflows, { id: crypto.randomUUID(), name: wfName.trim(), command: wfCommand.trim() }];
                      setWorkflowsState(updated);
                      try { (window as any).tai?.workflows?.set?.(updated); } catch {}
                      setWfName(''); setWfCommand('');
                    }}>
                      Add
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SettingRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className={styles.settingRow}>
      <span className={styles.settingLabel}>{label}</span>
      {value}
    </div>
  );
}
