import React, { useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Terminal, Copy, Sparkles } from 'lucide-react';
import type { AIEntry } from '@/types';

function formatDuration(ms: number): string {
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

interface InlineAIBlockProps {
  question: string;
  content: string;
  suggestedCommands?: string[];
  streaming?: boolean;
  duration?: number;
  entries?: AIEntry[];
  onRunCommand: (cmd: string) => void;
  onCopy?: (text: string) => void;
}

export function InlineAIBlock({
  question,
  content,
  suggestedCommands,
  streaming,
  duration,
  entries,
  onRunCommand,
  onCopy,
}: InlineAIBlockProps) {
  const runnableCommands = new Set(suggestedCommands ?? []);

  const handleCopyCode = useCallback((text: string) => {
    if (onCopy) onCopy(text);
    else navigator.clipboard.writeText(text);
  }, [onCopy]);

  const markdownComponents = {
    pre({ children }: { children?: React.ReactNode }) {
      const codeEl = children as React.ReactElement;
      const codeText = extractText(codeEl);
      const isRunnable = runnableCommands.has(codeText.trim());
      return (
        <div className="ai-code-wrap">
          <div className="ai-code-bar">
            <span className="ai-code-lang">command</span>
            <div className="ai-code-bar-actions">
              {isRunnable && (
                <span className="ai-code-bar-btn" title="Run in terminal" onClick={() => onRunCommand(codeText.trim())}>
                  <Terminal size={12} />
                  <span>Run</span>
                </span>
              )}
              <span className="ai-code-bar-btn" title="Copy" onClick={() => handleCopyCode(codeText)}>
                <Copy size={12} />
                <span>Copy</span>
              </span>
            </div>
          </div>
          <pre>{children}</pre>
        </div>
      );
    },
  };

  return (
    <div className="ai-wrapper">
      {question && (
        <div className="ai-prompt">
          <Sparkles size={13} className="ai-prompt-icon" />
          <span className="ai-prompt-text">{question}</span>
        </div>
      )}
      <div className="ai-block">
        <div className="ai-accent" />
        <div className="ai-inner">
          <div className="ai-header">
            <div className="ai-header-left">
              <span className="ai-label">Claude</span>
              {streaming && <span className="ai-streaming-dot" />}
            </div>
            {!streaming && duration != null && (
              <span className="ai-duration">{formatDuration(duration)}</span>
            )}
          </div>

        <div className="ai-body">
          {entries && entries.length > 0 ? (
            entries.map((entry, i) => {
              if (entry.kind === 'text') {
                return (
                  <div key={`text-${i}`} className="ai-content">
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                      {entry.text}
                    </ReactMarkdown>
                  </div>
                );
              }
              if (entry.kind === 'tool') {
                const call = entry.call;
                if (!call) return null;
                const hasOutput = call.output != null;
                return (
                  <div key={call.id || `tool-${i}`} className={`ai-tool${hasOutput ? '' : ' ai-tool-active'}`}>
                    <span className="ai-tool-icon">{hasOutput ? (call.error ? '\u2717' : '\u2713') : '\u25CB'}</span>
                    <span className="ai-tool-name">{call.name}</span>
                    <span className="ai-tool-input">{call.input}</span>
                    {!hasOutput && streaming && <span className="ai-tool-spin" />}
                  </div>
                );
              }
              return null;
            })
          ) : content ? (
            <div className="ai-content">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                {content}
              </ReactMarkdown>
            </div>
          ) : null}
        </div>
      </div>

      <style>{styles}</style>
      </div>
    </div>
  );
}

function extractText(node: React.ReactNode): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (!node) return '';
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (React.isValidElement(node)) {
    return extractText((node.props as { children?: React.ReactNode }).children);
  }
  return '';
}

const styles = `
  .ai-wrapper {
    margin: 6px 0 10px;
  }
  .ai-prompt {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 6px 8px;
    margin-bottom: 4px;
  }
  .ai-prompt-icon {
    color: var(--color-ai);
    flex-shrink: 0;
    margin-top: 2px;
    opacity: 0.7;
  }
  .ai-prompt-text {
    color: var(--text-primary);
    font-size: 12px;
    font-weight: 400;
    line-height: 1.5;
  }
  .ai-block {
    position: relative;
    border-radius: 8px;
    overflow: hidden;
    background: rgba(168, 95, 241, 0.04);
    border: 1px solid rgba(168, 95, 241, 0.1);
  }
  .ai-accent {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 2px;
    background: linear-gradient(90deg, var(--color-ai), rgba(168, 95, 241, 0.2) 70%, transparent);
  }
  .ai-inner {
    padding: 12px 14px;
  }
  .ai-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 10px;
    gap: 12px;
  }
  .ai-header-left {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }
  .ai-sparkle {
    color: var(--color-ai);
    opacity: 0.8;
  }
  .ai-label {
    color: var(--color-ai);
    font-size: 13px;
    font-weight: 600;
  }
  .ai-streaming-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--color-ai);
    animation: ai-pulse 1.2s ease-in-out infinite;
  }
  @keyframes ai-pulse {
    0%, 100% { opacity: 0.3; }
    50% { opacity: 1; }
  }
  .ai-duration {
    color: var(--text-muted);
    font-size: 11px;
    flex-shrink: 0;
    opacity: 0.6;
  }
  .ai-body {
    font-size: 13px;
    line-height: 1.65;
    color: var(--text-primary);
  }
  .ai-content p {
    margin: 0 0 8px;
  }
  .ai-content p:last-child {
    margin-bottom: 0;
  }
  .ai-content strong {
    color: var(--text-primary);
    font-weight: 600;
  }
  .ai-content code {
    background: rgba(255, 255, 255, 0.06);
    padding: 2px 6px;
    border-radius: 3px;
    color: var(--text-primary);
    font-size: 12.5px;
  }
  .ai-content ul, .ai-content ol {
    margin: 6px 0;
    padding-left: 20px;
  }
  .ai-content li {
    margin-bottom: 3px;
  }
  .ai-content a {
    color: #58a6ff;
    text-decoration: none;
  }
  .ai-content a:hover {
    text-decoration: underline;
  }

  .ai-code-wrap {
    border-radius: 6px;
    overflow: hidden;
    margin: 8px 0;
    border: 1px solid rgba(255, 255, 255, 0.06);
  }
  .ai-code-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 10px;
    background: rgba(255, 255, 255, 0.04);
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }
  .ai-code-lang {
    font-size: 11px;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }
  .ai-code-bar-actions {
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .ai-code-bar-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    border-radius: 3px;
    font-size: 11px;
    color: var(--text-muted);
    cursor: pointer;
    transition: all 0.15s;
  }
  .ai-code-bar-btn:hover {
    color: var(--text-primary);
    background: rgba(255, 255, 255, 0.06);
  }
  .ai-code-wrap pre {
    background: var(--bg-base);
    margin: 0;
    padding: 10px 12px;
    overflow-x: auto;
  }
  .ai-code-wrap pre code {
    background: none;
    padding: 0;
    border-radius: 0;
    font-size: 13px;
    color: var(--text-primary);
  }

  .ai-tool {
    font-size: 12px;
    margin-bottom: 3px;
    padding: 2px 0;
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--text-muted);
  }
  .ai-tool-active {
    color: var(--text-secondary);
  }
  .ai-tool-icon {
    font-size: 10px;
    width: 14px;
    text-align: center;
    flex-shrink: 0;
    color: var(--color-ai);
  }
  .ai-tool-active .ai-tool-icon {
    color: var(--color-ai);
  }
  .ai-tool-name {
    font-weight: 500;
    color: var(--text-secondary);
    flex-shrink: 0;
  }
  .ai-tool-active .ai-tool-name {
    color: var(--color-ai);
  }
  .ai-tool-input {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    direction: rtl;
    text-align: left;
    opacity: 0.5;
  }
  .ai-tool-spin {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--color-ai);
    animation: ai-pulse 1.2s ease-in-out infinite;
    flex-shrink: 0;
  }
`;
