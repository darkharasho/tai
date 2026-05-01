import styles from './Toggle.module.css';

interface ToggleProps {
  checked: boolean;
  onChange: (value: boolean) => void;
  ariaLabel?: string;
}

export function Toggle({ checked, onChange, ariaLabel }: ToggleProps) {
  return (
    <label className={styles.toggle}>
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        aria-label={ariaLabel}
      />
      <span className={styles.track} />
    </label>
  );
}
