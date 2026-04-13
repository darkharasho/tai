import { useRef, useEffect, useState, useCallback } from 'react';
import { Wrench } from 'lucide-react';
import { CommandBlock } from './CommandBlock';
import { InlineAIBlock } from './InlineAIBlock';
import { ApprovalPrompt } from './ApprovalPrompt';
import type { SegmentedBlock, AIEntry } from '@/types';

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
    <div className="tn-block-list">
      <div className="tn-spacer" />

      {items.length === 0 && (
        <div className="tn-welcome">
          <div className="tn-welcome-title">tai</div>
          <div className="tn-welcome-section">
            <div className="tn-welcome-row">
              <span className="tn-welcome-key">Enter</span> Run shell command
            </div>
            <div className="tn-welcome-row">
              <span className="tn-welcome-key">Shift+Tab</span> Toggle AI mode
            </div>
          </div>
          <div className="tn-welcome-hint">Type a command or ask AI a question</div>
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
              <div className={`tm-tool-approval ${item.status !== 'pending' ? 'tm-tool-resolved' : ''}`}>
                <div className="tm-tool-approval-header">
                  <span className="tm-tool-approval-label">
                    <span style={{ display: 'inline-flex', verticalAlign: 'middle', marginRight: 4 }}>
                      <Wrench size={12} />
                    </span>
                    {item.toolName}
                  </span>
                  {item.status === 'approved' && <span className="tm-tool-status tm-tool-approved">{'\u2713'} allowed</span>}
                  {item.status === 'rejected' && <span className="tm-tool-status tm-tool-rejected">{'\u2717'} denied</span>}
                </div>
                <div className="tm-tool-approval-command">{item.command}</div>
                {item.status === 'pending' && (
                  <div className="tm-tool-approval-actions">
                    <button className="tm-tool-btn tm-tool-btn-approve" onClick={() => onToolApprove(item as DisplayItem & { type: 'approval' })}>Allow</button>
                    <button className="tm-tool-btn tm-tool-btn-deny" onClick={() => onToolReject(item as DisplayItem & { type: 'approval' })}>Deny</button>
                  </div>
                )}
              </div>
            </div>
          );
        }

        return null;
      })}

      <div ref={bottomRef} style={{ overflowAnchor: 'auto' }} />

      <style>{`
        .tn-block-list {
          flex: 1;
          min-height: 0;
          padding: 10px 14px 0;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
        }
        .tn-spacer {
          flex: 1 0 0px;
          overflow-anchor: none;
        }
        .tn-welcome {
          font-size: 13px;
          color: var(--text-muted);
          line-height: 1.8;
          margin-bottom: 16px;
          padding-left: 8px;
        }
        .tn-welcome-title {
          color: var(--color-shell);
          font-size: 14px;
          font-weight: 600;
          margin-bottom: 8px;
          opacity: 0.7;
        }
        .tn-welcome-section {
          margin-bottom: 6px;
        }
        .tn-welcome-row {
          margin-bottom: 1px;
        }
        .tn-welcome-key {
          color: var(--text-secondary);
          font-size: 12px;
          margin-right: 8px;
        }
        .tn-welcome-hint {
          color: var(--text-muted);
          font-size: 12px;
          margin-top: 4px;
          opacity: 0.6;
        }
        .tm-tool-approval {
          font-size: 14px;
          border-left: 2px solid rgba(168, 85, 247, 0.3);
          padding-left: 8px;
          margin-bottom: 4px;
          padding: 4px 0 4px 8px;
        }
        .tm-tool-resolved {
          opacity: 0.45;
        }
        .tm-tool-approval-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 3px;
        }
        .tm-tool-approval-label {
          color: var(--color-ai);
          font-weight: 500;
          font-size: 11px;
          opacity: 0.8;
        }
        .tm-tool-status {
          font-size: 10px;
          font-weight: 500;
          opacity: 0.7;
        }
        .tm-tool-approved { color: var(--color-shell); }
        .tm-tool-rejected { color: var(--color-error); }
        .tm-tool-approval-command {
          color: var(--text-primary);
          word-break: break-all;
          font-size: 11px;
          margin-bottom: 4px;
        }
        .tm-tool-approval-actions {
          display: flex;
          gap: 6px;
        }
        .tm-tool-btn {
          font-family: var(--font-mono);
          font-size: 10px;
          padding: 2px 8px;
          border-radius: 2px;
          border: 1px solid var(--border-subtle);
          background: transparent;
          color: var(--text-secondary);
          cursor: pointer;
          transition: all 0.15s;
        }
        .tm-tool-btn:hover { background: var(--bg-surface); }
        .tm-tool-btn-approve { border-color: rgba(0, 255, 136, 0.3); color: var(--color-shell); }
        .tm-tool-btn-approve:hover { background: rgba(0, 255, 136, 0.08); }
        .tm-tool-btn-deny { border-color: rgba(239, 68, 68, 0.3); color: var(--color-error); }
        .tm-tool-btn-deny:hover { background: rgba(239, 68, 68, 0.08); }
      `}</style>
    </div>
  );
}
