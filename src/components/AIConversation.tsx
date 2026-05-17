import type { ReactNode } from 'react';
import styles from './AIConversation.module.css';

interface AIConversationProps {
  children: ReactNode;
}

export function AIConversation({ children }: AIConversationProps) {
  return (
    <div className={styles.conversation}>
      <div className={styles.rail} aria-hidden="true" />
      <span className={`${styles.dot} ${styles.dotUser}`} aria-hidden="true" />
      <span className={`${styles.dot} ${styles.dotAi}`} aria-hidden="true" />
      {children}
    </div>
  );
}
