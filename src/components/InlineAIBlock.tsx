import React, { useCallback, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { Terminal, Copy, Square, Check, X, Circle, FileText, Pencil, FolderSearch, Search, Globe, ChevronRight, ChevronDown, type LucideIcon } from 'lucide-react';
import type { AIEntry, AIProvider } from '@/types';
import styles from './InlineAIBlock.module.css';
import ToolCallBody, { formatToolLabel } from './ToolCallBody';
import { QueuedChip } from './QueuedChip';
import { useSettings } from '@/hooks/useSettings';

const PROVIDER_NAMES: Record<AIProvider, string> = {
  claude: 'Claude',
  codex: 'Codex',
  gemini: 'Gemini',
};

const PROVIDER_ICONS: Record<AIProvider, string> = {
  claude: './svg/claude.svg',
  codex: './svg/openai.svg',
  gemini: './svg/Google-gemini-icon.svg',
};

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
  aiProvider?: AIProvider;
  queuedPrompts?: { id: string; text: string }[];
  onEditQueued?: (id: string, text: string) => void;
  onRemoveQueued?: (id: string) => void;
  isFollowup?: boolean;
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
  aiProvider = 'claude',
  queuedPrompts,
  onEditQueued,
  onRemoveQueued,
  isFollowup = false,
}: InlineAIBlockProps) {
  const runnableCommands = new Set(suggestedCommands ?? []);
  const { config } = useSettings();
  const expandAllByDefault: boolean = config['ai.expandToolCalls'] ?? false;

  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set());

  const toggleTool = useCallback((id: string, defaultOpen: boolean) => {
    setExpandedTools(prev => {
      const next = new Set(prev);
      if (defaultOpen) {
        const collapseKey = `collapsed:${id}`;
        if (next.has(collapseKey)) next.delete(collapseKey);
        else next.add(collapseKey);
      } else {
        if (next.has(id)) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }, []);

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
    td({ children, ...props }: React.HTMLAttributes<HTMLTableCellElement>) {
      const text = extractText(children).trim();
      const isNumeric = text.length > 0 && /^[\d,.\s$%+\-/x×]+$/.test(text);
      return <td className={isNumeric ? 'num' : undefined} {...props}>{children}</td>;
    },
    tr({ children, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
      const childArr = React.Children.toArray(children);
      const firstCellText = extractText(childArr[0]).trim();
      const isSummary = /^(total|totals|sum|subtotal|grand total|average|avg|mean)\b/i.test(firstCellText);
      return <tr className={isSummary ? 'summary' : undefined} {...props}>{children}</tr>;
    },
  };

  return (
    <div className={styles.wrapper}>
      {question && (
        <div className={styles.prompt}>
          <span className={`${styles.promptLabel}${isFollowup ? ` ${styles.promptLabelFollowup}` : ''}`}>
            {isFollowup ? '↪ You' : 'You'}
          </span>
          <div className={styles.promptText}>
            <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>
              {question}
            </ReactMarkdown>
          </div>
        </div>
      )}
      {(streaming || content || (entries && entries.length > 0)) && (
        <div className={styles.block}>
          <div className={styles.accent} />
          <div className={styles.inner}>
            <div className={styles.header}>
              <div className={styles.headerLeft}>
                <span
                  className={styles.providerIcon}
                  style={{ maskImage: `url(${PROVIDER_ICONS[aiProvider]})`, WebkitMaskImage: `url(${PROVIDER_ICONS[aiProvider]})` }}
                />
                <span className={styles.label}>{PROVIDER_NAMES[aiProvider]}</span>
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
                    const toolId = call.id || `tool-${i}`;
                    const defaultOpen = expandAllByDefault || call.name === 'TodoWrite';
                    const collapseKey = `collapsed:${toolId}`;
                    const isExpanded = defaultOpen
                      ? !expandedTools.has(collapseKey)
                      : expandedTools.has(toolId);
                    const hasExpandableContent = hasOutput || call.name === 'Edit' || call.name === 'TodoWrite' || expandAllByDefault;
                    const label = formatToolLabel(call.name, call.input);
                    return (
                      <div key={toolId}>
                        <div
                          className={`${styles.tool}${hasOutput ? '' : ` ${styles.toolActive}`}${hasExpandableContent ? ` ${styles.toolClickable}` : ''}`}
                          onClick={hasExpandableContent ? () => toggleTool(toolId, defaultOpen) : undefined}
                        >
                          {hasExpandableContent && (
                            <span className={styles.toolChevron}>
                              {isExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                            </span>
                          )}
                          <span className={styles.toolIcon}><ToolIcon name={call.name} /></span>
                          <span className={styles.toolName}>{call.name}</span>
                          <span className={styles.toolLabel}>{label}</span>
                          {!hasOutput && streaming && <span className={styles.toolSpin} />}
                          {hasOutput && (
                            <span className={call.error ? styles.toolStatusError : styles.toolStatusOk}>
                              {call.error ? <X size={10} /> : <Check size={10} />}
                            </span>
                          )}
                        </div>
                        {isExpanded && <ToolCallBody call={call} />}
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

            {queuedPrompts && queuedPrompts.length > 0 && onEditQueued && onRemoveQueued && (
              <div className={styles.queueRow}>
                <span className={styles.queueLabel}>Queued</span>
                {queuedPrompts.map(q => (
                  <QueuedChip
                    key={q.id}
                    text={q.text}
                    onSave={(text) => onEditQueued(q.id, text)}
                    onRemove={() => onRemoveQueued(q.id)}
                  />
                ))}
              </div>
            )}
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
