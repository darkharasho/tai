// src/components/ToolCallBody.tsx
import React, { useState, useEffect, useRef } from 'react';
import { AlertCircle, Copy } from 'lucide-react';
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

    return input;
  } catch {
    return input;
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

function OutputSection({ output, lang, label = 'output' }: { output: string; lang: string; label?: string }) {
  const [showAll, setShowAll] = useState(false);
  const parsed = parseToolError(output);

  if (parsed.isError) {
    return (
      <div className="ai-code-wrap">
        <CodeBar label="error" code={parsed.message} />
        <div className={styles.errorDisplay}>
          <AlertCircle size={12} />
          <span>{parsed.message}</span>
        </div>
      </div>
    );
  }

  const { truncated, isTruncated, totalLines } = truncateLines(parsed.message, MAX_LINES);
  const displayText = showAll ? parsed.message : truncated;

  return (
    <div className="ai-code-wrap">
      <CodeBar label={label} code={parsed.message} />
      <HighlightedCode code={displayText} lang={lang} />
      {isTruncated && (
        <button className={styles.showMore} onClick={() => setShowAll(prev => !prev)}>
          {showAll ? 'Show less' : `Show all (${totalLines} lines)`}
        </button>
      )}
    </div>
  );
}

export default function ToolCallBody({ call }: { call: AIToolCall }) {
  const [showAll, setShowAll] = useState(false);

  try {
    const parsed = JSON.parse(call.input);

    // Edit — unified diff
    if (call.name === 'Edit' && parsed.old_string != null) {
      const filePath = parsed.file_path || '';
      const fullDiff = (parsed.old_string || '') + '\n' + (parsed.new_string || '');
      return (
        <div className={styles.body}>
          <div className="ai-code-wrap">
            <CodeBar label={filePath ? `diff · ${filePath.split('/').pop()}` : 'diff'} code={fullDiff} />
            <DiffView oldString={parsed.old_string || ''} newString={parsed.new_string || ''} filePath={filePath} />
          </div>
          {call.output && <OutputSection output={call.output} lang="text" />}
        </div>
      );
    }

    // Bash — show output
    if (call.name === 'Bash' && call.output) {
      const outputParsed = parseToolError(call.output);
      if (outputParsed.isError) {
        return (
          <div className={styles.body}>
            <div className="ai-code-wrap">
              <CodeBar label="error" code={outputParsed.message} />
              <div className={styles.errorDisplay}>
                <AlertCircle size={12} />
                <span>{outputParsed.message}</span>
              </div>
            </div>
          </div>
        );
      }
      const { truncated, isTruncated, totalLines } = truncateLines(call.output, MAX_LINES);
      return (
        <div className={styles.body}>
          <div className="ai-code-wrap">
            <CodeBar label="bash" code={call.output} />
            <pre className={styles.plainCode}><code>{showAll ? call.output : truncated}</code></pre>
            {isTruncated && (
              <button className={styles.showMore} onClick={() => setShowAll(prev => !prev)}>
                {showAll ? 'Show less' : `Show all (${totalLines} lines)`}
              </button>
            )}
          </div>
        </div>
      );
    }

    // Read — syntax-highlighted output
    if (call.name === 'Read' && call.output) {
      const filePath = parsed.file_path || '';
      const lang = detectLangFromPath(filePath);
      const fileName = filePath.split('/').pop() || 'output';
      return (
        <div className={styles.body}>
          <OutputSection output={call.output} lang={lang} label={fileName} />
        </div>
      );
    }

    // Write — syntax-highlighted content from input
    if (call.name === 'Write' && parsed.content) {
      const filePath = parsed.file_path || '';
      const lang = detectLangFromPath(filePath);
      const fileName = filePath.split('/').pop() || 'output';
      const { truncated, isTruncated, totalLines } = truncateLines(parsed.content, MAX_LINES);
      return (
        <div className={styles.body}>
          <div className="ai-code-wrap">
            <CodeBar label={fileName} code={parsed.content} />
            <HighlightedCode code={showAll ? parsed.content : truncated} lang={lang} />
            {isTruncated && (
              <button className={styles.showMore} onClick={() => setShowAll(prev => !prev)}>
                {showAll ? 'Show less' : `Show all (${totalLines} lines)`}
              </button>
            )}
          </div>
        </div>
      );
    }

    // Grep/Glob and others — plain output
    if (call.output) {
      const { truncated, isTruncated, totalLines } = truncateLines(call.output, MAX_LINES);
      return (
        <div className={styles.body}>
          <div className="ai-code-wrap">
            <CodeBar label={call.name.toLowerCase()} code={call.output} />
            <pre className={styles.plainCode}><code>{showAll ? call.output : truncated}</code></pre>
            {isTruncated && (
              <button className={styles.showMore} onClick={() => setShowAll(prev => !prev)}>
                {showAll ? 'Show less' : `Show all (${totalLines} lines)`}
              </button>
            )}
          </div>
        </div>
      );
    }

    return null;
  } catch {
    // Malformed input — show raw output if available
    if (call.output) {
      const { truncated, isTruncated, totalLines } = truncateLines(call.output, MAX_LINES);
      return (
        <div className={styles.body}>
          <div className="ai-code-wrap">
            <CodeBar label="output" code={call.output} />
            <pre className={styles.plainCode}><code>{showAll ? call.output : truncated}</code></pre>
            {isTruncated && (
              <button className={styles.showMore} onClick={() => setShowAll(prev => !prev)}>
                {showAll ? 'Show less' : `Show all (${totalLines} lines)`}
              </button>
            )}
          </div>
        </div>
      );
    }
    return null;
  }
}
