# Expandable Tool Output Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make AI tool execution lines expandable with formatted input labels, syntax-highlighted output, and unified diff rendering.

**Architecture:** Three new files (shiki utility, ToolCallBody component + CSS module) and modifications to InlineAIBlock. Pure functions (`formatToolLabel`, `truncateLines`, `detectLangFromPath`) are tested first, then wired into React components.

**Tech Stack:** React, Shiki v4 (syntax highlighting), CSS Modules, Vitest

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/utils/shikiHighlighter.ts` | Create | Lazy singleton shiki highlighter, language detection from file paths |
| `src/components/ToolCallBody.tsx` | Create | Smart label parsing, expanded body rendering (diff, code, bash output) |
| `src/components/ToolCallBody.module.css` | Create | Styles for expanded content (code blocks, diffs, show-more, errors) |
| `src/components/InlineAIBlock.tsx` | Modify | Add expand/collapse state, chevrons, smart labels, render ToolCallBody |
| `src/components/InlineAIBlock.module.css` | Modify | Clickable tool rows, hover state, chevron style, replace toolInput with toolLabel |
| `tests/unit/shikiHighlighter.test.ts` | Create | Tests for `detectLangFromPath` |
| `tests/unit/toolCallBody.test.ts` | Create | Tests for `formatToolLabel` and `truncateLines` |

---

### Task 1: Shiki Highlighter Utility

**Files:**
- Create: `src/utils/shikiHighlighter.ts`
- Create: `tests/unit/shikiHighlighter.test.ts`

- [ ] **Step 1: Write tests for `detectLangFromPath`**

```typescript
// tests/unit/shikiHighlighter.test.ts
import { describe, it, expect } from 'vitest';
import { detectLangFromPath } from '@/utils/shikiHighlighter';

describe('detectLangFromPath', () => {
  it('detects TypeScript files', () => {
    expect(detectLangFromPath('src/app.ts')).toBe('typescript');
    expect(detectLangFromPath('src/app.tsx')).toBe('typescript');
  });

  it('detects JavaScript files', () => {
    expect(detectLangFromPath('src/app.js')).toBe('javascript');
    expect(detectLangFromPath('src/app.jsx')).toBe('javascript');
  });

  it('detects Python files', () => {
    expect(detectLangFromPath('script.py')).toBe('python');
  });

  it('detects JSON files', () => {
    expect(detectLangFromPath('package.json')).toBe('json');
  });

  it('detects CSS files', () => {
    expect(detectLangFromPath('styles.css')).toBe('css');
  });

  it('detects shell scripts', () => {
    expect(detectLangFromPath('run.sh')).toBe('bash');
    expect(detectLangFromPath('run.bash')).toBe('bash');
  });

  it('detects markdown', () => {
    expect(detectLangFromPath('README.md')).toBe('markdown');
  });

  it('detects YAML', () => {
    expect(detectLangFromPath('config.yaml')).toBe('yaml');
    expect(detectLangFromPath('config.yml')).toBe('yaml');
  });

  it('detects Rust and Go', () => {
    expect(detectLangFromPath('main.rs')).toBe('rust');
    expect(detectLangFromPath('main.go')).toBe('go');
  });

  it('detects HTML', () => {
    expect(detectLangFromPath('index.html')).toBe('html');
  });

  it('returns text for unknown extensions', () => {
    expect(detectLangFromPath('file.xyz')).toBe('text');
    expect(detectLangFromPath('noext')).toBe('text');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/shikiHighlighter.test.ts`
Expected: FAIL — `detectLangFromPath` not found

- [ ] **Step 3: Implement `shikiHighlighter.ts`**

```typescript
// src/utils/shikiHighlighter.ts
import { type Highlighter, createHighlighter } from 'shiki';

const LANG_MAP: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript',
  js: 'javascript', jsx: 'javascript',
  py: 'python',
  json: 'json',
  css: 'css',
  html: 'html',
  md: 'markdown',
  yaml: 'yaml', yml: 'yaml',
  rs: 'rust',
  go: 'go',
  sh: 'bash', bash: 'bash',
  toml: 'toml',
};

const THEME = 'github-dark';

export function detectLangFromPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase();
  return (ext && LANG_MAP[ext]) || 'text';
}

let highlighterPromise: Promise<Highlighter> | null = null;

function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: [THEME],
      langs: Object.values(LANG_MAP).filter((v, i, a) => a.indexOf(v) === i),
    });
  }
  return highlighterPromise;
}

export async function highlightCode(code: string, lang: string): Promise<string> {
  if (lang === 'text' || lang === 'diff') return '';
  try {
    const highlighter = await getHighlighter();
    return highlighter.codeToHtml(code, { lang, theme: THEME });
  } catch {
    return '';
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/shikiHighlighter.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/shikiHighlighter.ts tests/unit/shikiHighlighter.test.ts
git commit -m "feat: add shiki highlighter utility with language detection"
```

---

### Task 2: Smart Label Parsing and Truncation

**Files:**
- Create: `src/components/ToolCallBody.tsx` (partial — just the exported helper functions)
- Create: `tests/unit/toolCallBody.test.ts`

- [ ] **Step 1: Write tests for `formatToolLabel` and `truncateLines`**

```typescript
// tests/unit/toolCallBody.test.ts
import { describe, it, expect } from 'vitest';
import { formatToolLabel, truncateLines } from '@/components/ToolCallBody';

describe('formatToolLabel', () => {
  it('extracts command for Bash', () => {
    expect(formatToolLabel('Bash', '{"command":"npm run build","timeout":30000}')).toBe('npm run build');
  });

  it('extracts file_path for Read', () => {
    expect(formatToolLabel('Read', '{"file_path":"src/components/App.tsx"}')).toBe('src/components/App.tsx');
  });

  it('extracts file_path for Edit', () => {
    expect(formatToolLabel('Edit', '{"file_path":"src/app.ts","old_string":"a","new_string":"b"}')).toBe('src/app.ts');
  });

  it('extracts file_path for Write', () => {
    expect(formatToolLabel('Write', '{"file_path":"src/utils/helper.ts","content":"..."}')).toBe('src/utils/helper.ts');
  });

  it('extracts pattern for Grep with path', () => {
    expect(formatToolLabel('Grep', '{"pattern":"handleClick","path":"src/"}')).toBe('"handleClick" · src/');
  });

  it('extracts pattern for Grep without path', () => {
    expect(formatToolLabel('Grep', '{"pattern":"handleClick"}')).toBe('"handleClick"');
  });

  it('extracts pattern for Glob', () => {
    expect(formatToolLabel('Glob', '{"pattern":"**/*.tsx"}')).toBe('**/*.tsx');
  });

  it('extracts url for WebFetch', () => {
    expect(formatToolLabel('WebFetch', '{"url":"https://example.com/api"}')).toBe('https://example.com/api');
  });

  it('extracts query for WebSearch', () => {
    expect(formatToolLabel('WebSearch', '{"query":"react shiki setup"}')).toBe('react shiki setup');
  });

  it('falls back to raw input for unknown tools', () => {
    expect(formatToolLabel('Unknown', '{"foo":"bar"}')).toBe('{"foo":"bar"}');
  });

  it('falls back to raw input on invalid JSON', () => {
    expect(formatToolLabel('Bash', 'not json')).toBe('not json');
  });
});

describe('truncateLines', () => {
  it('returns full text when under limit', () => {
    const text = 'line1\nline2\nline3';
    const result = truncateLines(text, 20);
    expect(result.isTruncated).toBe(false);
    expect(result.truncated).toBe(text);
    expect(result.totalLines).toBe(3);
  });

  it('truncates text over limit', () => {
    const lines = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`);
    const text = lines.join('\n');
    const result = truncateLines(text, 20);
    expect(result.isTruncated).toBe(true);
    expect(result.truncated.split('\n').length).toBe(20);
    expect(result.totalLines).toBe(50);
  });

  it('handles empty string', () => {
    const result = truncateLines('', 20);
    expect(result.isTruncated).toBe(false);
    expect(result.truncated).toBe('');
    expect(result.totalLines).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/toolCallBody.test.ts`
Expected: FAIL — functions not found

- [ ] **Step 3: Implement `formatToolLabel` and `truncateLines`**

Add these exported functions to the top of `src/components/ToolCallBody.tsx`:

```typescript
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
      const parts = [`"${parsed.pattern}"`];
      if (parsed.path) parts.push(parsed.path);
      else if (parsed.type) parts.push(parsed.type);
      return parts.join(' · ');
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
```

Leave the rest of the file as a placeholder export for now (the component will be built in Task 3):

```typescript
export default function ToolCallBody({ call }: { call: AIToolCall }) {
  return null;
}
```

- [ ] **Step 4: Create empty CSS module so the import resolves**

```css
/* src/components/ToolCallBody.module.css */
/* Styles added in Task 4 */
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/unit/toolCallBody.test.ts`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add src/components/ToolCallBody.tsx src/components/ToolCallBody.module.css tests/unit/toolCallBody.test.ts
git commit -m "feat: add formatToolLabel and truncateLines utility functions"
```

---

### Task 3: ToolCallBody Component

**Files:**
- Modify: `src/components/ToolCallBody.tsx` (replace the placeholder `ToolCallBody` component)

- [ ] **Step 1: Implement the ToolCallBody component**

Replace the placeholder `export default function ToolCallBody` in `src/components/ToolCallBody.tsx` with the full implementation:

```typescript
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
```

- [ ] **Step 2: Verify build compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Run all existing tests to ensure no regressions**

Run: `npx vitest run`
Expected: All PASS

- [ ] **Step 4: Commit**

```bash
git add src/components/ToolCallBody.tsx
git commit -m "feat: implement ToolCallBody component with diff, syntax highlighting, and output rendering"
```

---

### Task 4: ToolCallBody Styles

**Files:**
- Modify: `src/components/ToolCallBody.module.css`

- [ ] **Step 1: Write the CSS module**

Replace the placeholder content in `src/components/ToolCallBody.module.css`:

```css
/* src/components/ToolCallBody.module.css */

.body {
  margin: 4px 0 6px;
  border: 1px solid var(--border-card);
  border-radius: 6px;
  overflow: hidden;
}

/* Syntax-highlighted code (shiki output) */
.highlighted {
  font-size: 11px;
  line-height: 1.6;
}

.highlighted :global(pre) {
  margin: 0;
  padding: 8px 10px;
  background: transparent !important;
  border-radius: 0;
}

.highlighted :global(code) {
  font-family: var(--font-mono);
  font-size: inherit;
  background: none;
  padding: 0;
}

/* Plain code fallback */
.plainCode {
  margin: 0;
  padding: 8px 10px;
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.6;
  color: var(--text-secondary);
  background: transparent;
  white-space: pre-wrap;
  word-break: break-word;
}

/* Unified diff */
.diffBlock {
  margin: 0;
  padding: 6px 0;
  background: transparent;
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.6;
}

.diffBlock code {
  font-size: inherit;
  background: none;
  padding: 0;
}

.diffAdd {
  display: flex;
  padding: 0 10px;
  white-space: pre-wrap;
  background: rgba(72, 100, 40, 0.35);
}

.diffDel {
  display: flex;
  padding: 0 10px;
  white-space: pre-wrap;
  background: rgba(180, 60, 40, 0.25);
}

.diffMarker {
  flex-shrink: 0;
  width: 1.5ch;
  color: var(--text-muted);
  user-select: none;
}

/* Show more/less button */
.showMore {
  display: block;
  width: 100%;
  padding: 5px 10px;
  background: none;
  border: none;
  border-top: 1px solid var(--border-card);
  color: var(--color-ai);
  font-family: var(--font-sans);
  font-size: 11px;
  cursor: pointer;
  text-align: center;
}

.showMore:hover {
  background: rgba(255, 255, 255, 0.03);
}

/* Error display */
.errorDisplay {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  color: var(--color-error);
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.5;
  padding: 8px 10px;
  white-space: pre-wrap;
  word-break: break-word;
}

.errorDisplay svg {
  flex-shrink: 0;
  margin-top: 2px;
}

/* Output section with label */
.outputSection {
  border-top: 1px dashed var(--border-card);
}

.outputHeader {
  padding: 6px 10px 0;
}

.outputLabel {
  font-family: var(--font-sans);
  font-size: 10px;
  text-transform: uppercase;
  color: var(--text-muted);
  letter-spacing: 0.5px;
}
```

- [ ] **Step 2: Verify build compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/components/ToolCallBody.module.css
git commit -m "feat: add ToolCallBody styles for diffs, code blocks, and output sections"
```

---

### Task 5: Wire Into InlineAIBlock

**Files:**
- Modify: `src/components/InlineAIBlock.tsx`
- Modify: `src/components/InlineAIBlock.module.css`

- [ ] **Step 1: Update InlineAIBlock imports**

In `src/components/InlineAIBlock.tsx`, update the imports at lines 1-6:

Replace:
```typescript
import { Terminal, Copy, Sparkles, Square, Check, X, Circle, FileText, Pencil, FolderSearch, Search, Globe, type LucideIcon } from 'lucide-react';
```

With:
```typescript
import { Terminal, Copy, Sparkles, Square, Check, X, Circle, FileText, Pencil, FolderSearch, Search, Globe, ChevronRight, ChevronDown, type LucideIcon } from 'lucide-react';
```

Add after the existing imports:
```typescript
import ToolCallBody, { formatToolLabel } from './ToolCallBody';
```

- [ ] **Step 2: Add expanded state**

Inside the `InlineAIBlock` component function (after the `runnableCommands` line), add:

```typescript
const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set());

const toggleTool = useCallback((id: string) => {
  setExpandedTools(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
}, []);
```

Also add `useState` to the React import at line 1:

Replace:
```typescript
import React, { useCallback } from 'react';
```

With:
```typescript
import React, { useCallback, useState } from 'react';
```

- [ ] **Step 3: Replace tool row rendering**

Replace the tool entry rendering block (lines 127-146) — from `if (entry.kind === 'tool') {` through the closing `}`:

```typescript
if (entry.kind === 'tool') {
  const call = entry.call;
  if (!call) return null;
  const hasOutput = call.output != null;
  const toolId = call.id || `tool-${i}`;
  const isExpanded = expandedTools.has(toolId);
  const hasExpandableContent = hasOutput || (call.name === 'Edit' && call.input);
  const label = formatToolLabel(call.name, call.input);
  return (
    <div key={toolId}>
      <div
        className={`${styles.tool}${hasOutput ? '' : ` ${styles.toolActive}`}${hasExpandableContent ? ` ${styles.toolClickable}` : ''}`}
        onClick={hasExpandableContent ? () => toggleTool(toolId) : undefined}
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
```

- [ ] **Step 4: Update InlineAIBlock CSS**

In `src/components/InlineAIBlock.module.css`, make these changes:

Replace the `.tool` block (lines 260-268):
```css
.tool {
  font-size: 12px;
  margin-bottom: 3px;
  padding: 2px 0;
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text-muted);
}
```

With:
```css
.tool {
  font-size: 12px;
  margin-bottom: 3px;
  padding: 2px 4px;
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text-muted);
  border-radius: 4px;
}

.toolClickable {
  cursor: pointer;
}

.toolClickable:hover {
  background: rgba(255, 255, 255, 0.03);
}

.toolChevron {
  display: inline-flex;
  flex-shrink: 0;
  color: var(--text-muted);
}
```

Replace the `.toolInput` block (lines 293-303):
```css
.toolInput {
  font-family: var(--font-mono);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  direction: rtl;
  text-align: left;
  opacity: 0.5;
}
```

With:
```css
.toolLabel {
  font-family: var(--font-mono);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  opacity: 0.5;
}
```

- [ ] **Step 5: Verify build compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Run all tests**

Run: `npx vitest run`
Expected: All PASS

- [ ] **Step 7: Commit**

```bash
git add src/components/InlineAIBlock.tsx src/components/InlineAIBlock.module.css
git commit -m "feat: wire expandable tool output into InlineAIBlock with smart labels and chevrons"
```

---

### Task 6: Visual Testing and Polish

**Files:**
- Possibly modify: `src/components/ToolCallBody.tsx`, `src/components/ToolCallBody.module.css`, `src/components/InlineAIBlock.module.css`

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`

- [ ] **Step 2: Test the feature in the browser**

Open the app, trigger an AI conversation that uses tools (ask AI to do something that involves Read, Edit, Bash, Grep). Verify:

1. Tool rows show smart labels (file paths, commands, patterns) instead of raw JSON
2. Completed tool rows show a chevron (▶) on the left
3. Clicking a tool row expands it to show formatted output
4. Clicking again collapses it
5. Edit tools show unified diff with red/green highlighting
6. Bash tools show monospace output
7. Long output truncates at 20 lines with "Show all" button
8. "Show all" expands, button changes to "Show less"
9. Error output shows red with icon
10. Active/streaming tools don't show chevron (no output yet)
11. Syntax highlighting loads for known file types

- [ ] **Step 3: Fix any visual issues found**

Adjust padding, colors, font sizes, or spacing as needed to match TAI's design language.

- [ ] **Step 4: Commit any polish changes**

```bash
git add -A
git commit -m "fix: polish expandable tool output visual styling"
```
