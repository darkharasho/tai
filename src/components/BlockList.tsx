import { useRef, useEffect, useState, useCallback } from 'react';
import { Wrench } from 'lucide-react';
import { CommandBlock } from './CommandBlock';
import { InlineAIBlock } from './InlineAIBlock';
import { ApprovalPrompt } from './ApprovalPrompt';
import type { SegmentedBlock, AIEntry } from '@/types';
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
}

const AUTO_COLLAPSE_THRESHOLD = 10;

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
}: BlockListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [manualExpanded, setManualExpanded] = useState<Set<string>>(new Set());
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
      setManualExpanded(prev => new Set([...prev, id]));
    } else {
      setManualExpanded(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setManualCollapsed(prev => new Set([...prev, id]));
    }
  }, []);

  const commandBlocks = items.filter(item => item.type === 'command');
  const commandCount = commandBlocks.length;

  function isCollapsed(item: DisplayItem & { type: 'command' }): boolean {
    const id = item.block.id;
    const isActive = item.active || id === activeBlockId;
    if (isActive) return false;
    if (manualCollapsed.has(id)) return true;
    const blockIndex = commandBlocks.findIndex(b => b.type === 'command' && b.block.id === id);
    const distanceFromEnd = commandCount - 1 - blockIndex;
    const autoCollapse = distanceFromEnd >= AUTO_COLLAPSE_THRESHOLD;
    if (autoCollapse && !manualExpanded.has(id)) return true;
    return false;
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

      {items.map((item) => {
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
              />
            </div>
          );
        }

        if (item.type === 'ai') {
          return (
            <div key={item.id}>
              <InlineAIBlock
                question={item.question}
                content={item.content}
                suggestedCommands={item.suggestedCommands}
                streaming={item.streaming}
                duration={item.duration}
                entries={item.entries}
                onRunCommand={onRunSuggested}
                onCopy={onCopy}
              />
            </div>
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
                  {item.status === 'approved' && <span className={`${styles.toolStatus} ${styles.toolApproved}`}>{'\u2713'} allowed</span>}
                  {item.status === 'rejected' && <span className={`${styles.toolStatus} ${styles.toolRejected}`}>{'\u2717'} denied</span>}
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
      })}

      <div ref={bottomRef} style={{ overflowAnchor: 'auto' }} />
    </div>
  );
}
