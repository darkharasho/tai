import { Plus, X, Minus, Square, Settings, PanelLeft, Search } from 'lucide-react';
import styles from './TopBar.module.css';

const isMac = window.tai?.system?.platform === 'darwin';

interface TopBarProps {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onNewTab: () => void;
  onOpenSettings: () => void;
  onOpenPalette: () => void;
}

/**
 * Warp's window chrome: a thin icon cluster on the left, a search pill floating
 * in the centre, icons and the window controls on the right. The bar itself is
 * the drag region; every interactive child opts back out with `no-drag`.
 */
export function TopBar({ sidebarOpen, onToggleSidebar, onNewTab, onOpenSettings, onOpenPalette }: TopBarProps) {
  return (
    <div className={`${styles.bar}${isMac ? ` ${styles.barMac}` : ''}`}>
      <div className={styles.cluster}>
        <button
          className={`${styles.iconBtn} ${sidebarOpen ? styles.iconBtnOn : ''}`}
          onClick={onToggleSidebar}
          title={sidebarOpen ? 'Hide tabs' : 'Show tabs'}
          aria-label={sidebarOpen ? 'Hide tabs' : 'Show tabs'}
        >
          <PanelLeft size={14} />
        </button>
        <button className={styles.iconBtn} onClick={onNewTab} title="New tab" aria-label="New tab">
          <Plus size={15} />
        </button>
      </div>

      {/* Not a text field: it opens the command palette, which is where TAI
          already does search. Rendering it as a pill keeps Warp's shape
          without growing a second, competing search surface. */}
      <button className={styles.searchPill} onClick={onOpenPalette}>
        <Search size={12} />
        <span className={styles.searchLabel}>Search commands, workflows, history</span>
        <span className={styles.searchKbd}>{isMac ? '⌘' : 'Ctrl'} K</span>
      </button>

      <div className={styles.cluster}>
        <button className={styles.iconBtn} onClick={onOpenSettings} title="Settings" aria-label="Settings">
          <Settings size={14} />
        </button>
        {!isMac && (
          <>
            <div className={styles.separator} />
            <div className={styles.windowControls}>
              <button onClick={() => window.tai?.window?.minimize()} className={styles.windowBtn} aria-label="Minimize">
                <Minus size={14} />
              </button>
              <button onClick={() => window.tai?.window?.maximize()} className={styles.windowBtn} aria-label="Maximize">
                <Square size={12} />
              </button>
              <button onClick={() => window.tai?.window?.close()} className={`${styles.windowBtn} ${styles.windowBtnClose}`} aria-label="Close">
                <X size={14} />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
