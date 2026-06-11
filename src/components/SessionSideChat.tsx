import { useState, useEffect, useRef } from 'react';
import { X, Sparkles } from 'lucide-react';
import { InlineAIBlock } from './InlineAIBlock';
import type { DisplayItem } from './BlockList';
import type { AIProvider } from '@/types';
import styles from './SessionSideChat.module.css';

interface SessionSideChatProps {
  items: Array<DisplayItem & { type: 'ai' }>;
  onAsk: (text: string) => void;
  onClose: () => void;
  onCopy: (text: string) => void;
  onRunCommand: (command: string) => void;
  onStopAI?: () => void;
  aiProvider?: AIProvider;
}

/**
 * Side conversation pinned next to a live session card: same AI items as the
 * main stream, framed against the running process. Closes with the session.
 */
export function SessionSideChat({ items, onAsk, onClose, onCopy, onRunCommand, onStopAI, aiProvider }: SessionSideChatProps) {
  const [value, setValue] = useState('');
  const bodyRef = useRef<HTMLDivElement>(null);

  // Follow the newest reply.
  const last = items[items.length - 1];
  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items.length, last?.content]);

  return (
    <div className={styles.panel}>
      <div className={styles.head}>
        <Sparkles size={12} className={styles.headIcon} />
        <span className={styles.headLabel}>session chat</span>
        <button className={styles.closeBtn} title="Close side chat" onClick={onClose}>
          <X size={12} />
        </button>
      </div>
      <div className={styles.body} ref={bodyRef}>
        {items.map((item, i) => (
          <InlineAIBlock
            key={item.id}
            question={item.question}
            content={item.content}
            suggestedCommands={item.suggestedCommands}
            streaming={item.streaming}
            duration={item.duration}
            entries={item.entries}
            onRunCommand={onRunCommand}
            onCopy={onCopy}
            onStop={item.streaming ? onStopAI : undefined}
            aiProvider={aiProvider}
            isFollowup={i > 0}
          />
        ))}
      </div>
      <div className={styles.inputRow}>
        <input
          className={styles.input}
          value={value}
          placeholder="ask about this session…"
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && value.trim()) {
              e.preventDefault();
              onAsk(value);
              setValue('');
            } else if (e.key === 'Escape') {
              e.preventDefault();
              onClose();
            }
          }}
        />
      </div>
    </div>
  );
}
