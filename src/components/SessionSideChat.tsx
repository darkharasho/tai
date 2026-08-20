import { useState, useEffect, useRef } from 'react';
import { X, Sparkles } from 'lucide-react';
import { InlineAIBlock } from './InlineAIBlock';
import type { DisplayItem } from './BlockList';
import type { AIProvider } from '@/types';
import type { SessionKind } from '@/utils/sessionKind';
import styles from './SessionSideChat.module.css';

interface SessionSideChatProps {
  items: Array<DisplayItem & { type: 'ai' }>;
  onAsk: (text: string) => void;
  onClose: () => void;
  onCopy: (text: string) => void;
  onRunCommand: (command: string) => void;
  onStopAI?: () => void;
  aiProvider?: AIProvider;
  /** The process this conversation is about — shown in the header and chip row. */
  sessionName?: string;
  sessionKind?: SessionKind;
}

const KIND_LABELS: Record<SessionKind, string> = {
  oneshot: 'session',
  server: 'server',
  watch: 'watch',
  agent: 'agent',
};

/**
 * Side conversation pinned next to a live session card: same AI items as the
 * main stream, framed against the running process. Closes with the session.
 *
 * Chrome matches the rest of the app rather than the old purple-railed card:
 * a surface-toned pane (the tab sidebar's treatment) with a hairline AI accent
 * along the top edge, and a composer built like TerminalInput — context chips,
 * a flush field, a quiet key hint.
 */
export function SessionSideChat({
  items,
  onAsk,
  onClose,
  onCopy,
  onRunCommand,
  onStopAI,
  aiProvider,
  sessionName,
  sessionKind,
}: SessionSideChatProps) {
  const [value, setValue] = useState('');
  const bodyRef = useRef<HTMLDivElement>(null);

  // Follow the newest reply.
  const last = items[items.length - 1];
  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items.length, last?.content]);

  const kindLabel = sessionKind ? KIND_LABELS[sessionKind] : null;

  return (
    <div className={styles.panel}>
      <div className={styles.head}>
        <Sparkles size={12} className={styles.headIcon} />
        <span className={styles.headTitle}>session chat</span>
        {sessionName && (
          <span className={styles.headScope} title={sessionName}>· {sessionName}</span>
        )}
        <span className={styles.grow} />
        <button className={styles.iconBtn} title="Close side chat (Esc)" onClick={onClose}>
          <X size={13} />
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
      <div className={styles.composer}>
        <div className={styles.chipRow}>
          <span className={`${styles.chip} ${styles.chipAi}`}>ai{aiProvider ? ` · ${aiProvider}` : ''}</span>
          {sessionName && (
            <span className={styles.chip} title={sessionName}>
              {kindLabel ? `${kindLabel} · ` : ''}{sessionName}
            </span>
          )}
        </div>
        <div className={styles.field}>
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
        <div className={styles.hint}>
          <span className={styles.kbd}>⏎</span> send
          <span className={styles.hintSep}>·</span>
          <span className={styles.kbd}>esc</span> close
        </div>
      </div>
    </div>
  );
}
