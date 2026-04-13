import { useState, useRef, useEffect } from 'react';
import { Settings, X, ChevronDown, Check } from 'lucide-react';
import styles from './QuickSettings.module.css';

interface QuickSettingsProps {
  visible: boolean;
  onClose: () => void;
  colorMode: string;
  onColorModeChange: (mode: string) => void;
}

type Category = 'general';

const COLOR_MODE_OPTIONS = [
  { value: 'high', label: 'High' },
  { value: 'low', label: 'Low' },
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

export function QuickSettings({ visible, onClose, colorMode, onColorModeChange }: QuickSettingsProps) {
  const [category, setCategory] = useState<Category>('general');

  if (!visible) return null;

  const categories: { id: Category; label: string }[] = [
    { id: 'general', label: 'General' },
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
              <div className={styles.settingRow}>
                <span className={styles.settingLabel}>Color Mode</span>
                <CustomDropdown
                  value={colorMode}
                  options={COLOR_MODE_OPTIONS}
                  onChange={onColorModeChange}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
