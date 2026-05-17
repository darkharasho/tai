import { useRef, useEffect, useState, useCallback } from 'react';
import { Wrench, Check, X } from 'lucide-react';
import { CommandBlock } from './CommandBlock';
import { InlineAIBlock } from './InlineAIBlock';
import { AIConversation } from './AIConversation';
import { ApprovalPrompt } from './ApprovalPrompt';
import type { SegmentedBlock, AIEntry, AIProvider } from '@/types';
import { groupConversations } from '@/utils/groupConversations';
import styles from './BlockList.module.css';

export type DisplayItem =
  | { type: 'command'; block: SegmentedBlock; aiSuggested?: boolean; active?: boolean; awaitingInput?: boolean }
  | { type: 'ai'; id: string; question: string; content: string; suggestedCommands: string[]; streaming: boolean; duration?: number; entries?: AIEntry[] }
  | { type: 'approval'; id: string; command: string; toolUseId: string; toolName: string; status: 'pending' | 'approved' | 'rejected' };

interface BlockListProps {
  items: DisplayItem[];
  activeBlockId: string | null;
  awaitingInput?: boolean;
  cwd?: string;
  onCopy: (text: string) => void;
  onAskAI: (block: SegmentedBlock) => void;
  onRerun: (command: string) => void;
  onRunSuggested: (command: string) => void;
  onToolApprove: (item: DisplayItem & { type: 'approval' }) => void;
  onToolReject: (item: DisplayItem & { type: 'approval' }) => void;
  onStopAI?: () => void;
  onSendInput?: (data: string) => void;
  aiProvider?: AIProvider;
  queuedPrompts?: { id: string; text: string }[];
  onEditQueued?: (id: string, text: string) => void;
  onRemoveQueued?: (id: string) => void;
}

export function BlockList({
  items,
  activeBlockId,
  awaitingInput,
  cwd,
  onCopy,
  onAskAI,
  onRerun,
  onRunSuggested,
  onToolApprove,
  onToolReject,
  onStopAI,
  onSendInput,
  aiProvider,
  queuedPrompts,
  onEditQueued,
  onRemoveQueued,
}: BlockListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [manualCollapsed, setManualCollapsed] = useState<Set<string>>(new Set());

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'instant' });
  }, [items]);

  const handleToggleCollapse = useCallback((id: string, currentlyCollapsed: boolean) => {
    if (currentlyCollapsed) {
      setManualCollapsed(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    } else {
      setManualCollapsed(prev => new Set([...prev, id]));
    }
  }, []);

  function isCollapsed(item: DisplayItem & { type: 'command' }): boolean {
    const id = item.block.id;
    const isActive = item.active || id === activeBlockId;
    if (isActive) return false;
    return manualCollapsed.has(id);
  }

  function renderItem(item: DisplayItem, opts: { isFollowup?: boolean } = {}) {
    if (item.type === 'command') {
      const collapsed = isCollapsed(item);
      const id = item.block.id;
      return (
        <div key={id}>
          <CommandBlock
            block={item.block}
            collapsed={collapsed}
            onToggleCollapse={() => handleToggleCollapse(id, collapsed)}
            active={item.active || id === activeBlockId}
            awaitingInput={(item.active || id === activeBlockId) ? awaitingInput : false}
            aiSuggested={item.aiSuggested}
            cwd={cwd}
            onCopy={onCopy}
            onAskAI={onAskAI}
            onRerun={onRerun}
            onSendInput={(item.active || id === activeBlockId) ? onSendInput : undefined}
          />
        </div>
      );
    }

    if (item.type === 'ai') {
      return (
        <InlineAIBlock
          key={item.id}
          question={item.question}
          content={item.content}
          suggestedCommands={item.suggestedCommands}
          streaming={item.streaming}
          duration={item.duration}
          entries={item.entries}
          onRunCommand={onRunSuggested}
          onCopy={onCopy}
          onStop={item.streaming ? onStopAI : undefined}
          aiProvider={aiProvider}
          queuedPrompts={item.streaming ? queuedPrompts : undefined}
          onEditQueued={item.streaming ? onEditQueued : undefined}
          onRemoveQueued={item.streaming ? onRemoveQueued : undefined}
          isFollowup={opts.isFollowup}
        />
      );
    }

    if (item.type === 'approval') {
      return (
        <div key={item.id}>
          <div className={`${styles.toolApproval}${item.status !== 'pending' ? ` ${styles.toolResolved}` : ''}`}>
            <div className={styles.toolApprovalHeader}>
              <span className={styles.toolApprovalLabel}>
                <span style={{ display: 'inline-flex', verticalAlign: 'middle', marginRight: 4 }}>
                  <Wrench size={12} />
                </span>
                {item.toolName}
              </span>
              {item.status === 'approved' && <span className={`${styles.toolStatus} ${styles.toolApproved}`}><Check size={12} /> allowed</span>}
              {item.status === 'rejected' && <span className={`${styles.toolStatus} ${styles.toolRejected}`}><X size={12} /> denied</span>}
            </div>
            <div className={styles.toolApprovalCommand}>{item.command}</div>
            {item.status === 'pending' && (
              <div className={styles.toolApprovalActions}>
                <button className={`${styles.toolBtn} ${styles.toolBtnApprove}`} onClick={() => onToolApprove(item as DisplayItem & { type: 'approval' })}>Allow</button>
                <button className={`${styles.toolBtn} ${styles.toolBtnDeny}`} onClick={() => onToolReject(item as DisplayItem & { type: 'approval' })}>Deny</button>
              </div>
            )}
          </div>
        </div>
      );
    }

    return null;
  }

  return (
    <div className={styles.blockList}>
      <div className={styles.spacer} />

      {items.length === 0 && (
        <div className={styles.welcome}>
          <div className={styles.welcomeTitle}>tai</div>
          <div className={styles.welcomeSection}>
            <div className={styles.welcomeRow}>
              <span className={styles.welcomeKey}>Enter</span> Run shell command
            </div>
            <div className={styles.welcomeRow}>
              <span className={styles.welcomeKey}>Shift+Tab</span> Toggle AI mode
            </div>
          </div>
          <div className={styles.welcomeHint}>Type a command or ask AI a question</div>
        </div>
      )}

      {groupConversations(items).map((group) => {
        if (group.kind === 'passthrough') {
          return renderItem(group.item);
        }
        const key = group.items.map(i => i.id).join('|');
        return (
          <AIConversation key={key}>
            {group.items.map((aiItem, i) => renderItem(aiItem, { isFollowup: i > 0 }))}
          </AIConversation>
        );
      })}

      <div ref={bottomRef} style={{ overflowAnchor: 'auto' }} />
    </div>
  );
}
