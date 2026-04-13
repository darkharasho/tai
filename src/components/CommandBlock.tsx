import { useState, useMemo, useCallback } from 'react';
import { ansiToHtml } from '@/utils/ansiToHtml';
import type { SegmentedBlock } from '@/types';

const LONG_OUTPUT_LINES = 30;

function formatDuration(ms: number): string {
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

function extractPromptParts(promptText: string): { user: string; path: string } {
  const match = promptText.match(/^(\S+?)[@:]?\s*(~[^\s$#%]*|\/[^\s$#%]*)/);
  if (match) return { user: match[1], path: match[2] };
  const clean = promptText.replace(/[\$#%>\s]+$/, '').trim();
  return { user: clean, path: '' };
}

interface CommandBlockProps {
  block: SegmentedBlock;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  active?: boolean;
  awaitingInput?: boolean;
  aiSuggested?: boolean;
  cwd?: string;
  onCopy: (text: string) => void;
  onAskAI: (block: SegmentedBlock) => void;
  onRerun: (command: string) => void;
}

export function CommandBlock({
  block,
  collapsed,
  onToggleCollapse,
  active,
  awaitingInput,
  aiSuggested,
  cwd,
}: CommandBlockProps) {
  const [showAll, setShowAll] = useState(false);

  const outputLines = block.output ? block.output.split('\n') : [];
  const isLong = outputLines.length > LONG_OUTPUT_LINES;
  const isClamped = isLong && !showAll;
  const coloredOutput = useMemo(() => {
    const raw = block.rawOutput || block.output;
    return raw ? ansiToHtml(raw) : '';
  }, [block.rawOutput, block.output]);

  const handleOutputClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.tagName === 'A' && target.dataset.url) {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        window.open(target.dataset.url, '_blank');
      }
    }
  }, []);

  let { user, path } = extractPromptParts(block.promptText);
  if (!user && !path && cwd) {
    const shortCwd = cwd.replace(/^\/var\/home\/[^/]+/, '~').replace(/^\/home\/[^/]+/, '~');
    path = shortCwd;
  }
  const isRemote = block.isRemote;

  if (collapsed) {
    return (
      <div className="cb-collapsed" onClick={() => onToggleCollapse?.()}>
        <span className="cb-prompt-user" style={{ color: isRemote ? '#f59e0b' : 'var(--color-shell)' }}>{user}</span>
        {path && <span className="cb-prompt-path">{path}</span>}
        <span className="cb-prompt-sep">$</span>
        <span className="cb-cmd-dim">{block.command}</span>
        <span className="cb-meta">{formatDuration(block.duration)}</span>
        <style>{styles}</style>
      </div>
    );
  }

  return (
    <div className={`cb-block${active ? ' cb-active' : ''}`}>
      <div className="cb-prompt-line" onClick={() => onToggleCollapse?.()}>
        <div className="cb-prompt-left">
          <span className="cb-prompt-user" style={{ color: isRemote ? '#f59e0b' : 'var(--color-shell)' }}>{user}</span>
          {path && <span className="cb-prompt-path">{path}</span>}
          <span className="cb-prompt-sep">$</span>
          <span className="cb-cmd">{block.command}</span>
          {aiSuggested && <span className="cb-via-ai">ai</span>}
        </div>
        <div className="cb-prompt-right">
          {active ? (
            awaitingInput ? (
              <span className="cb-awaiting">
                <span className="cb-awaiting-dot" />
                INPUT
              </span>
            ) : (
              <span className="cb-running" />
            )
          ) : (
            <span className="cb-meta">{formatDuration(block.duration)}</span>
          )}
        </div>
      </div>

      {block.output && (
        <div className="cb-output-area">
          <div
            className="cb-output"
            style={isClamped ? { maxHeight: '300px', overflowY: 'hidden' } : undefined}
            dangerouslySetInnerHTML={{ __html: coloredOutput }}
            onClick={handleOutputClick}
          />
          {isLong && (
            <div className="cb-show-more" onClick={() => setShowAll(v => !v)}>
              {showAll ? 'less' : `${outputLines.length} lines`}
            </div>
          )}
        </div>
      )}

      <style>{styles}</style>
    </div>
  );
}

const styles = `
  .cb-block {
    font-size: 14px;
    margin-bottom: 2px;
    padding: 4px 0;
    border-left: 2px solid transparent;
    padding-left: 8px;
    transition: border-color 0.2s;
  }
  .cb-active {
    border-left-color: rgba(0, 255, 136, 0.3);
  }
  .cb-collapsed {
    font-size: 14px;
    padding: 2px 0 2px 8px;
    margin-bottom: 1px;
    opacity: 0.4;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 6px;
    border-left: 2px solid transparent;
    transition: opacity 0.15s;
  }
  .cb-collapsed:hover {
    opacity: 0.65;
  }
  .cb-prompt-line {
    display: flex;
    align-items: center;
    justify-content: space-between;
    cursor: pointer;
    user-select: none;
    min-height: 22px;
  }
  .cb-prompt-left {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    overflow: hidden;
  }
  .cb-prompt-right {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    margin-left: 12px;
  }
  .cb-prompt-user {
    font-weight: 500;
    flex-shrink: 0;
  }
  .cb-prompt-path {
    color: #3b82f6;
    flex-shrink: 0;
  }
  .cb-prompt-sep {
    color: var(--text-muted);
    flex-shrink: 0;
  }
  .cb-cmd {
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .cb-cmd-dim {
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
    min-width: 0;
  }
  .cb-via-ai {
    color: var(--color-ai);
    font-size: 10px;
    opacity: 0.5;
    flex-shrink: 0;
  }
  .cb-meta {
    color: var(--text-muted);
    font-size: 11px;
    flex-shrink: 0;
  }
  .cb-running {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--color-shell);
    animation: cb-pulse 1.5s ease-in-out infinite;
  }
  @keyframes cb-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.25; }
  }
  .cb-awaiting {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 10px;
    font-weight: 600;
    color: #eab308;
    letter-spacing: 0.5px;
    animation: cb-pulse 2s ease-in-out infinite;
  }
  .cb-awaiting-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #eab308;
  }
  .cb-output-area {
    margin-top: 2px;
    margin-left: 2px;
  }
  .cb-output {
    color: var(--text-primary);
    font-size: 13px;
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-all;
  }
  .cb-show-more {
    font-size: 11px;
    color: var(--text-muted);
    cursor: pointer;
    padding-top: 2px;
    opacity: 0.7;
  }
  .cb-show-more:hover {
    color: #58a6ff;
    opacity: 1;
  }
  .cb-link {
    color: #58a6ff;
    text-decoration: none;
    cursor: pointer;
    position: relative;
  }
  .cb-link:hover {
    text-decoration: underline;
  }
  .cb-link::after {
    content: 'Ctrl+Click to open';
    position: absolute;
    bottom: 100%;
    left: 0;
    padding: 2px 6px;
    background: #1e1e2e;
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 3px;
    font-size: 10px;
    color: var(--text-muted);
    white-space: nowrap;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.15s;
    z-index: 10;
  }
  .cb-link:hover::after {
    opacity: 1;
  }
`;
