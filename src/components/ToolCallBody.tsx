// src/components/ToolCallBody.tsx
import React, { useState, useEffect, useRef } from 'react';
import { AlertCircle, Copy, Square, CheckSquare, Loader } from 'lucide-react';
import type { AIToolCall } from '@/types';
import { detectLangFromPath, highlightCode } from '@/utils/shikiHighlighter';
import styles from './ToolCallBody.module.css';

function CodeBar({ label, code }: { label: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="ai-code-bar">
      <span className="ai-code-lang">{label}</span>
      <div className="ai-code-bar-actions">
        <span className="ai-code-bar-btn" title="Copy" onClick={handleCopy}>
          <Copy size={12} />
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </span>
      </div>
    </div>
  );
}

function OutputBar({ label, code, first }: { label: string; code: string; first?: boolean }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className={`${styles.outputBar}${first ? ` ${styles.outputBarFirst}` : ''}`}>
      <span className={styles.outputBarLabel}>{label}</span>
      <span className={styles.outputBarBtn} onClick={handleCopy}>
        <Copy size={11} />
        <span>{copied ? 'Copied' : 'Copy'}</span>
      </span>
    </div>
  );
}

export function formatToolLabel(name: string, input: string): string {
  try {
    const parsed = JSON.parse(input);

    if (name === 'Bash' && parsed.command) return parsed.command;

    if (parsed.file_path) return parsed.file_path;

    if (parsed.pattern) {
      if (name === 'Grep') {
        const parts = [`"${parsed.pattern}"`];
        if (parsed.path) parts.push(parsed.path);
        else if (parsed.type) parts.push(parsed.type);
        return parts.join(' · ');
      }
      return parsed.pattern;
    }

    if (parsed.url) return parsed.url;
    if (parsed.query) return parsed.query;

    if (name === 'TodoWrite' && Array.isArray(parsed.todos)) {
      const total = parsed.todos.length;
      const done = parsed.todos.filter((t: { status: string }) => t.status === 'completed').length;
      return `${done}/${total} done`;
    }

    const firstStr = Object.values(parsed).find(v => typeof v === 'string' && v.length > 0);
    if (firstStr) return String(firstStr).slice(0, 80);

    return '';
  } catch {
    return input.slice(0, 80);
  }
}

export function truncateLines(text: string, max: number): { truncated: string; isTruncated: boolean; totalLines: number } {
  const lines = text.split('\n');
  const totalLines = lines.length;
  if (totalLines <= max) return { truncated: text, isTruncated: false, totalLines };
  return { truncated: lines.slice(0, max).join('\n'), isTruncated: true, totalLines };
}

const MAX_LINES = 20;

function parseToolError(output: string): { isError: boolean; message: string } {
  const stripped = output.trim();
  const tagMatch = stripped.match(/^<(?:tool_use_error|tool_error|error)>([\s\S]*?)<\/(?:tool_use_error|tool_error|error)>$/);
  if (tagMatch) return { isError: true, message: tagMatch[1].trim() };
  return { isError: false, message: output };
}

function HighlightedCode({ code, lang }: { code: string; lang: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [html, setHtml] = useState('');

  useEffect(() => {
    if (!code || lang === 'text') return;
    highlightCode(code, lang).then(result => {
      if (result) setHtml(result);
    });
  }, [code, lang]);

  if (html) {
    return <div ref={ref} className={styles.highlighted} dangerouslySetInnerHTML={{ __html: html }} />;
  }
  return <pre className={styles.plainCode}><code>{code}</code></pre>;
}

function DiffView({ oldString, newString, filePath }: { oldString: string; newString: string; filePath: string }) {
  const lang = detectLangFromPath(filePath);
  const [oldHtml, setOldHtml] = useState<string[]>([]);
  const [newHtml, setNewHtml] = useState<string[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const oldLines = oldString.split('\n');
    const newLines = newString.split('\n');

    if (lang === 'text') {
      setOldHtml(oldLines.map(l => escapeHtml(l)));
      setNewHtml(newLines.map(l => escapeHtml(l)));
      setReady(true);
      return;
    }

    highlightCode(oldString, lang).then(oldResult => {
      highlightCode(newString, lang).then(newResult => {
        setOldHtml(oldResult ? extractShikiLines(oldResult) : oldLines.map(l => escapeHtml(l)));
        setNewHtml(newResult ? extractShikiLines(newResult) : newLines.map(l => escapeHtml(l)));
        setReady(true);
      });
    });
  }, [oldString, newString, lang]);

  if (!ready) return null;

  return (
    <pre className={styles.diffBlock}>
      <code>
        {oldHtml.map((line, i) => (
          <div key={`del-${i}`} className={styles.diffDel}>
            <span className={styles.diffMarker}>-</span>
            <span dangerouslySetInnerHTML={{ __html: line || '&nbsp;' }} />
          </div>
        ))}
        {newHtml.map((line, i) => (
          <div key={`add-${i}`} className={styles.diffAdd}>
            <span className={styles.diffMarker}>+</span>
            <span dangerouslySetInnerHTML={{ __html: line || '&nbsp;' }} />
          </div>
        ))}
      </code>
    </pre>
  );
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function extractShikiLines(html: string): string[] {
  const codeMatch = html.match(/<code[^>]*>([\s\S]*)<\/code>/);
  const inner = codeMatch ? codeMatch[1] : '';
  const lineSpans = inner.split(/<span class="line">/);
  return lineSpans.slice(1).map(s => {
    const end = s.lastIndexOf('</span>');
    return end >= 0 ? s.substring(0, end) : s;
  });
}

interface Todo {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  priority: 'high' | 'medium' | 'low';
}

function TodoView({ todos }: { todos: Todo[] }) {
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  const sorted = [...todos].sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
  return (
    <div className={styles.todoList}>
      {sorted.map(todo => (
        <div key={todo.id} className={`${styles.todoItem} ${todo.status === 'completed' ? styles.todoDone : ''}`}>
          <span className={styles.todoIcon}>
            {todo.status === 'completed' ? <CheckSquare size={12} /> : todo.status === 'in_progress' ? <Loader size={12} /> : <Square size={12} />}
          </span>
          <span className={styles.todoContent}>{todo.content}</span>
          {todo.priority === 'high' && <span className={styles.todoPriorityHigh}>high</span>}
          {todo.priority === 'low' && <span className={styles.todoPriorityLow}>low</span>}
        </div>
      ))}
    </div>
  );
}

export default function ToolCallBody({ call }: { call: AIToolCall }) {
  const [showAllInput, setShowAllInput] = useState(false);
  const [showAllOutput, setShowAllOutput] = useState(false);

  try {
    const parsed = JSON.parse(call.input) as Record<string, unknown>;
    const filePath = (parsed.file_path as string) || '';

    // --- Build input section ---
    let inputLabel = 'input';
    let inputCopyText = '';
    let inputNode: React.ReactNode = null;

    if (call.name === 'TodoWrite' && Array.isArray(parsed.todos)) {
      inputLabel = 'todos';
      inputCopyText = (parsed.todos as Todo[]).map(t => `[${t.status}] ${t.content}`).join('\n');
      inputNode = <TodoView todos={parsed.todos as Todo[]} />;

    } else if (call.name === 'Edit' && parsed.old_string != null) {
      const pop = filePath.split('/').pop();
      inputLabel = pop ? `diff · ${pop}` : 'diff';
      inputCopyText = ((parsed.old_string as string) || '') + '\n' + ((parsed.new_string as string) || '');
      inputNode = (
        <DiffView
          oldString={(parsed.old_string as string) || ''}
          newString={(parsed.new_string as string) || ''}
          filePath={filePath}
        />
      );

    } else if (call.name === 'Bash' && parsed.command) {
      inputLabel = 'command';
      inputCopyText = parsed.command as string;
      inputNode = <pre className={styles.plainCode}><code>{parsed.command as string}</code></pre>;

    } else if (call.name === 'Write' && parsed.content) {
      const lang = detectLangFromPath(filePath);
      inputLabel = filePath.split('/').pop() || 'content';
      inputCopyText = parsed.content as string;
      const { truncated, isTruncated, totalLines } = truncateLines(parsed.content as string, MAX_LINES);
      inputNode = (
        <>
          <HighlightedCode code={showAllInput ? (parsed.content as string) : truncated} lang={lang} />
          {isTruncated && (
            <button className={styles.showMore} onClick={() => setShowAllInput(p => !p)}>
              {showAllInput ? 'Show less' : `Show all (${totalLines} lines)`}
            </button>
          )}
        </>
      );

    } else if (call.name === 'Read') {
      // no input section — file path already shown in tool row label

    } else {
      // Generic: pretty-print JSON, trim large values
      const display: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(parsed)) {
        display[k] = typeof v === 'string' && v.length > 300 ? v.slice(0, 300) + '…' : v;
      }
      const jsonStr = JSON.stringify(display, null, 2);
      if (jsonStr !== '{}') {
        inputLabel = call.name.toLowerCase();
        inputCopyText = JSON.stringify(parsed, null, 2);
        inputNode = <HighlightedCode code={jsonStr} lang="json" />;
      }
    }

    // --- Build output section ---
    let outputLabel = 'output';
    let outputCopyText = '';
    let outputNode: React.ReactNode = null;

    if (call.output) {
      const outParsed = parseToolError(call.output);
      outputCopyText = outParsed.message;

      if (outParsed.isError) {
        outputLabel = 'error';
        outputNode = (
          <div className={styles.errorDisplay}>
            <AlertCircle size={12} />
            <span>{outParsed.message}</span>
          </div>
        );
      } else {
        const outputLang = call.name === 'Read' ? detectLangFromPath(filePath) : 'text';
        if (call.name === 'Read') outputLabel = filePath.split('/').pop() || 'output';
        const { truncated, isTruncated, totalLines } = truncateLines(outParsed.message, MAX_LINES);
        outputNode = (
          <>
            <HighlightedCode code={showAllOutput ? outParsed.message : truncated} lang={outputLang} />
            {isTruncated && (
              <button className={styles.showMore} onClick={() => setShowAllOutput(p => !p)}>
                {showAllOutput ? 'Show less' : `Show all (${totalLines} lines)`}
              </button>
            )}
          </>
        );
      }
    }

    if (!inputNode && !outputNode) return null;

    return (
      <div className={styles.body}>
        <div className="ai-code-wrap">
          {inputNode && <OutputBar label={inputLabel} code={inputCopyText} first />}
          {inputNode}
          {outputNode && <OutputBar label={outputLabel} code={outputCopyText} first={!inputNode} />}
          {outputNode}
        </div>
      </div>
    );
  } catch {
    if (!call.output) return null;
    const outParsed = parseToolError(call.output);
    const { truncated, isTruncated, totalLines } = truncateLines(outParsed.message, MAX_LINES);
    return (
      <div className={styles.body}>
        <div className="ai-code-wrap">
          <pre className={styles.plainCode}>
            <code>{showAllOutput ? outParsed.message : truncated}</code>
          </pre>
          {isTruncated && (
            <button className={styles.showMore} onClick={() => setShowAllOutput(p => !p)}>
              {showAllOutput ? 'Show less' : `Show all (${totalLines} lines)`}
            </button>
          )}
        </div>
      </div>
    );
  }
}
