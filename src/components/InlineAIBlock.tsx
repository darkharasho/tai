import React, { useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Terminal, Copy, Sparkles, Square, Check, X, Circle, FileText, Pencil, FolderSearch, Search, Globe, type LucideIcon } from 'lucide-react';
import type { AIEntry } from '@/types';
import styles from './InlineAIBlock.module.css';

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
  onStop?: () => void;
}

const TOOL_ICONS: Record<string, LucideIcon> = {
  Bash: Terminal,
  Read: FileText,
  Write: Pencil,
  Edit: Pencil,
  Glob: FolderSearch,
  Grep: Search,
  WebFetch: Globe,
  WebSearch: Globe,
};

function ToolIcon({ name }: { name: string }) {
  const Icon = TOOL_ICONS[name] || Circle;
  return <Icon size={10} />;
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
  onStop,
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
    <div className={styles.wrapper}>
      {question && (
        <div className={styles.prompt}>
          <Sparkles size={13} className={styles.promptIcon} />
          <span className={styles.promptText}>{question}</span>
        </div>
      )}
      {(streaming || content || (entries && entries.length > 0)) && (
        <div className={styles.block}>
          <div className={styles.accent} />
          <div className={styles.inner}>
            <div className={styles.header}>
              <div className={styles.headerLeft}>
                <span className={styles.label}>Claude</span>
                {streaming && <span className={styles.streamingDot} />}
              </div>
              {streaming && onStop && (
                <button className={styles.stopBtn} onClick={onStop} title="Stop response (Ctrl+C)">
                  <Square size={10} />
                  <span>Stop</span>
                </button>
              )}
              {!streaming && duration != null && (
                <span className={styles.duration}>{formatDuration(duration)}</span>
              )}
            </div>

            <div className={styles.body}>
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
                      <div
                        key={call.id || `tool-${i}`}
                        className={`${styles.tool}${hasOutput ? '' : ` ${styles.toolActive}`}`}
                      >
                        <span className={styles.toolIcon}><ToolIcon name={call.name} /></span>
                        <span className={styles.toolName}>{call.name}</span>
                        <span className={styles.toolInput}>{call.input}</span>
                        {!hasOutput && streaming && <span className={styles.toolSpin} />}
                        {hasOutput && (
                          <span className={call.error ? styles.toolStatusError : styles.toolStatusOk}>
                            {call.error ? <X size={10} /> : <Check size={10} />}
                          </span>
                        )}
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
        </div>
      )}
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
