import { useRef, useEffect, useState, useCallback } from 'react';
import { Wrench, Check, X } from 'lucide-react';
import { CommandBlock } from './CommandBlock';
import { InlineAIBlock } from './InlineAIBlock';
import { AIConversation } from './AIConversation';
import { ApprovalPrompt } from './ApprovalPrompt';
import { AskUserQuestionView } from './AskUserQuestionView';
import { parseAskUserQuestion } from '@/utils/askUserQuestion';
import type { SegmentedBlock, AIEntry, AIProvider, BlockBodyMode } from '@/types';
import type { SessionKind } from '@/utils/sessionKind';
import type { ReactNode } from 'react';
import { groupConversations } from '@/utils/groupConversations';
import { isPinnedToBottom } from '@/utils/scrollPolicy';
import styles from './BlockList.module.css';

export type DisplayItem =
  | { type: 'command'; block: SegmentedBlock; aiSuggested?: boolean; active?: boolean; awaitingInput?: boolean; restored?: boolean; defaultCollapsed?: boolean }
  | { type: 'ai'; id: string; question: string; content: string; suggestedCommands: string[]; streaming: boolean; duration?: number; entries?: AIEntry[]; remote?: boolean }
  | { type: 'approval'; id: string; command: string; toolUseId: string; toolName: string; status: 'pending' | 'approved' | 'rejected'; input?: unknown; answers?: Record<string, string> };

interface BlockListProps {
  items: DisplayItem[];
  activeBlockId: string | null;
  awaitingInput?: boolean;
  cwd?: string;
  onCopy: (text: string) => void;
  onAskAI: (block: SegmentedBlock) => void;
  onRerun: (command: string) => void;
  onRunSuggested: (command: string) => void;
  /** `answers` is set only for AskUserQuestion, and is sent back as the tool's input. */
  onToolApprove: (item: DisplayItem & { type: 'approval' }, answers?: Record<string, string>) => void;
  onToolReject: (item: DisplayItem & { type: 'approval' }) => void;
  onStopAI?: () => void;
  onSendInput?: (data: string) => void;
  aiProvider?: AIProvider;
  queuedPrompts?: { id: string; text: string }[];
  onEditQueued?: (id: string, text: string) => void;
  onRemoveQueued?: (id: string) => void;
  activeBodyMode?: BlockBodyMode;
  ptyId?: number;
  onPasswordDone?: () => void;
  onInteractiveContainerRef?: (el: HTMLDivElement | null) => void;
  /** Epoch ms when this tab's AI session went remote (pill on), or null when
      local. Only blocks started after this moment wear the remote (orange)
      accent — history keeps the accent it was born with. */
  sessionRemoteSince?: number | null;
  /** Live session chrome for the ACTIVE in-list card (rooted sessions live in
      the scrollback, not a detached pinned region). */
  sessionKind?: SessionKind;
  port?: number | null;
  onSessionStop?: () => void;
  onSessionRestart?: () => void;
  onAIPrompt?: (text: string) => void;
  activeHeaderExtra?: ReactNode;
  /** Bumped on every composer submit; re-pins the list to the bottom. */
  submitToken?: number;
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
  activeBodyMode,
  ptyId,
  onPasswordDone,
  onInteractiveContainerRef,
  sessionRemoteSince,
  sessionKind,
  port,
  onSessionStop,
  onSessionRestart,
  onAIPrompt,
  activeHeaderExtra,
  submitToken,
}: BlockListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  // Warp-style auto-follow: only track new output while the user is pinned to
  // the bottom. Scrolling up into history releases the pin; returning to the
  // bottom re-arms it. Defaults pinned so fresh sessions follow output.
  const pinnedRef = useRef(true);
  const [manualCollapsed, setManualCollapsed] = useState<Set<string>>(new Set());

  const handleScroll = useCallback(() => {
    const el = listRef.current;
    if (el) pinnedRef.current = isPinnedToBottom(el);
  }, []);

  useEffect(() => {
    if (!pinnedRef.current) return;
    bottomRef.current?.scrollIntoView({ behavior: 'instant' });
  }, [items]);

  // Submitting re-arms the follow, the way typing at a shell prompt jumps you
  // back to the bottom. Without this, a list left unpinned (scrolled up to read
  // earlier output, or knocked loose when a finishing card resized) stays where
  // it is — so an AI answer streams in entirely below the fold and nothing ever
  // brings it into view. The user asked for this output; show it to them.
  useEffect(() => {
    if (submitToken === undefined) return;
    pinnedRef.current = true;
    bottomRef.current?.scrollIntoView({ behavior: 'instant' });
    // The turn renders (and then grows) over the following frames; the
    // ResizeObserver takes over once there is height to follow.
    const t = setTimeout(() => {
      if (pinnedRef.current) bottomRef.current?.scrollIntoView({ behavior: 'instant' });
    }, 120);
    return () => clearTimeout(t);
  }, [submitToken]);

  // The [items] effect only re-scrolls when the array identity changes, so it
  // misses content that grows in place: streaming output appended to an active
  // card (e.g. `ls`), or a finishing card expanding to its full height. Follow
  // the actual content box instead — while pinned, any height change re-pins to
  // the bottom. Scrolling up releases the pin (handleScroll), so history stays
  // put.
  useEffect(() => {
    const content = contentRef.current;
    if (!content || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      if (pinnedRef.current) bottomRef.current?.scrollIntoView({ behavior: 'instant' });
    });
    ro.observe(content);
    return () => ro.disconnect();
  }, []);

  // Re-scroll after layout settles whenever the active card transitions:
  //  - entering 'interactive' (alt-screen) → body grows to 72vh
  //  - entering 'output' while a command is running → card grows to 60vh
  // The instant-scroll on [items] runs before those min-heights apply, so the
  // grown card ends up half off-screen without this deferred pass.
  const hasActiveCommand = items.some(item => item.type === 'command' && item.active);
  useEffect(() => {
    if (!pinnedRef.current) return;
    if (activeBodyMode === 'interactive' || (hasActiveCommand && activeBodyMode === 'output')) {
      bottomRef.current?.scrollIntoView({ behavior: 'instant' });
      const t = setTimeout(() => {
        if (pinnedRef.current) bottomRef.current?.scrollIntoView({ behavior: 'instant' });
      }, 200);
      return () => clearTimeout(t);
    }
  }, [activeBodyMode, hasActiveCommand]);

  const handleToggleCollapse = useCallback((id: string) => {
    setManualCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Per-card stable toggle closures so memo(CommandBlock) isn't defeated by a
  // fresh function identity on every list render. handleToggleCollapse is
  // stable, so cached entries stay valid for the life of the session.
  const toggleFnsRef = useRef(new Map<string, () => void>());
  const toggleFor = useCallback((id: string) => {
    let fn = toggleFnsRef.current.get(id);
    if (!fn) {
      fn = () => handleToggleCollapse(id);
      toggleFnsRef.current.set(id, fn);
    }
    return fn;
  }, [handleToggleCollapse]);

  function isCollapsed(item: DisplayItem & { type: 'command' }): boolean {
    const id = item.block.id;
    const isActive = item.active || id === activeBlockId;
    if (isActive) return false;
    // manualCollapsed records "the user toggled this card". Fresh cards
    // default expanded; restored (previous-session) and finished session
    // cards (server/watch/agent) default collapsed.
    const toggled = manualCollapsed.has(id);
    return (item.restored || item.defaultCollapsed) ? !toggled : toggled;
  }

  function renderItem(item: DisplayItem, opts: { isFollowup?: boolean } = {}) {
    if (item.type === 'command') {
      const collapsed = isCollapsed(item);
      const id = item.block.id;
      const isActive = item.active || id === activeBlockId;
      return (
        <div key={id} data-item-id={id} className={isActive ? undefined : styles.cardWindow}>
          <CommandBlock
            block={item.block}
            collapsed={collapsed}
            onToggleCollapse={toggleFor(id)}
            active={isActive}
            awaitingInput={isActive ? awaitingInput : false}
            aiSuggested={item.aiSuggested}
            cwd={cwd}
            onCopy={onCopy}
            onAskAI={onAskAI}
            onRerun={onRerun}
            onSendInput={isActive ? onSendInput : undefined}
            bodyMode={isActive ? (activeBodyMode ?? 'output') : 'output'}
            ptyId={ptyId}
            onPasswordDone={onPasswordDone}
            isActive={isActive}
            onInteractiveContainerRef={isActive ? onInteractiveContainerRef : undefined}
            sessionRemote={sessionRemoteSince != null && item.block.startTime >= sessionRemoteSince}
            sessionKind={isActive ? sessionKind : item.block.sessionKind}
            port={isActive ? port : undefined}
            onStop={isActive ? onSessionStop : undefined}
            onRestart={isActive ? onSessionRestart : undefined}
            onAIPrompt={isActive ? onAIPrompt : undefined}
            headerExtra={isActive ? activeHeaderExtra : undefined}
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
          isRemote={item.remote ?? false}
        />
      );
    }

    if (item.type === 'approval') {
      // `command` is the JSON blob when the input has no obvious string to show,
      // so it is the fallback source for sessions restored without `input`.
      const questions = item.toolName === 'AskUserQuestion'
        ? parseAskUserQuestion(item.input ?? item.command)
        : null;
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
              {item.status === 'approved' && <span className={`${styles.toolStatus} ${styles.toolApproved}`}><Check size={12} /> {questions ? 'answered' : 'allowed'}</span>}
              {item.status === 'rejected' && <span className={`${styles.toolStatus} ${styles.toolRejected}`}><X size={12} /> denied</span>}
            </div>
            {questions
              ? <AskUserQuestionView
                  questions={questions}
                  answers={item.status === 'pending' ? undefined : (item.answers ?? {})}
                  onSubmit={item.status === 'pending'
                    ? (answers) => onToolApprove(item as DisplayItem & { type: 'approval' }, answers)
                    : undefined}
                  onSkip={item.status === 'pending'
                    ? () => onToolReject(item as DisplayItem & { type: 'approval' })
                    : undefined}
                />
              : <div className={styles.toolApprovalCommand}>{item.command}</div>}
            {/* Answering a question IS allowing it, so for AskUserQuestion the
                picker carries its own Send/Skip and this row is suppressed. */}
            {item.status === 'pending' && !questions && (
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
    <div className={styles.blockList} ref={listRef} onScroll={handleScroll}>
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

      <div ref={contentRef}>
        {groupConversations(items).map((group) => {
          if (group.kind === 'passthrough') {
            return renderItem(group.item);
          }
          // Key by the first item only: appending a follow-up must not change
          // the key, or the whole conversation remounts (flicker, lost state).
          const key = group.items[0].id;
          return (
            <AIConversation key={key}>
              {group.items.map((aiItem, i) => renderItem(aiItem, { isFollowup: i > 0 }))}
            </AIConversation>
          );
        })}

        <div ref={bottomRef} style={{ overflowAnchor: 'auto' }} />
      </div>
    </div>
  );
}
