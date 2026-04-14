// src/components/ToolCallBody.tsx
import React, { useState, useEffect, useRef } from 'react';
import { AlertCircle } from 'lucide-react';
import type { AIToolCall } from '@/types';
import { detectLangFromPath, highlightCode } from '@/utils/shikiHighlighter';
import styles from './ToolCallBody.module.css';

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

function OutputSection({ output, lang }: { output: string; lang: string }) {
  const [showAll, setShowAll] = useState(false);
  const parsed = parseToolError(output);

  if (parsed.isError) {
    return (
      <div className={styles.errorDisplay}>
        <AlertCircle size={12} />
        <span>{parsed.message}</span>
      </div>
    );
  }

  const { truncated, isTruncated, totalLines } = truncateLines(parsed.message, MAX_LINES);
  const displayText = showAll ? parsed.message : truncated;

  return (
    <div className={styles.outputSection}>
      <div className={styles.outputHeader}>
        <span className={styles.outputLabel}>Output</span>
      </div>
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
      return (
        <div className={styles.body}>
          <DiffView oldString={parsed.old_string || ''} newString={parsed.new_string || ''} filePath={parsed.file_path || ''} />
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
            <div className={styles.errorDisplay}>
              <AlertCircle size={12} />
              <span>{outputParsed.message}</span>
            </div>
          </div>
        );
      }
      const { truncated, isTruncated, totalLines } = truncateLines(call.output, MAX_LINES);
      return (
        <div className={styles.body}>
          <pre className={styles.plainCode}><code>{showAll ? call.output : truncated}</code></pre>
          {isTruncated && (
            <button className={styles.showMore} onClick={() => setShowAll(prev => !prev)}>
              {showAll ? 'Show less' : `Show all (${totalLines} lines)`}
            </button>
          )}
        </div>
      );
    }

    // Read — syntax-highlighted output
    if (call.name === 'Read' && call.output) {
      const lang = detectLangFromPath(parsed.file_path || '');
      return (
        <div className={styles.body}>
          <OutputSection output={call.output} lang={lang} />
        </div>
      );
    }

    // Write — syntax-highlighted content from input
    if (call.name === 'Write' && parsed.content) {
      const lang = detectLangFromPath(parsed.file_path || '');
      const { truncated, isTruncated, totalLines } = truncateLines(parsed.content, MAX_LINES);
      return (
        <div className={styles.body}>
          <HighlightedCode code={showAll ? parsed.content : truncated} lang={lang} />
          {isTruncated && (
            <button className={styles.showMore} onClick={() => setShowAll(prev => !prev)}>
              {showAll ? 'Show less' : `Show all (${totalLines} lines)`}
            </button>
          )}
        </div>
      );
    }

    // Grep/Glob and others — plain output
    if (call.output) {
      const { truncated, isTruncated, totalLines } = truncateLines(call.output, MAX_LINES);
      return (
        <div className={styles.body}>
          <pre className={styles.plainCode}><code>{showAll ? call.output : truncated}</code></pre>
          {isTruncated && (
            <button className={styles.showMore} onClick={() => setShowAll(prev => !prev)}>
              {showAll ? 'Show less' : `Show all (${totalLines} lines)`}
            </button>
          )}
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
          <pre className={styles.plainCode}><code>{showAll ? call.output : truncated}</code></pre>
          {isTruncated && (
            <button className={styles.showMore} onClick={() => setShowAll(prev => !prev)}>
              {showAll ? 'Show less' : `Show all (${totalLines} lines)`}
            </button>
          )}
        </div>
      );
    }
    return null;
  }
}
