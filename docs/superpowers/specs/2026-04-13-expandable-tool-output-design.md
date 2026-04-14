# Expandable Tool Output

AI tool execution lines become expandable cards showing formatted input and syntax-highlighted output.

## Decisions

- **Layout**: Hybrid — compact rows when collapsed (current style + chevron), bordered code block body when expanded
- **Content**: Both parsed input and output displayed when expanded
- **Diff style**: Unified diff for Edit tools (- red, + green)
- **Labels**: Smart labels parsed from JSON input (file paths, commands, patterns)
- **Truncation**: 20-line limit with "Show all (N lines)" button
- **Default state**: Collapsed
- **Syntax highlighting**: Shiki (already a dependency, needs utility setup)

## Component Architecture

### New Files

**`src/utils/shikiHighlighter.ts`**
Lazy singleton shiki highlighter. First call loads shiki and caches the instance; subsequent calls reuse it. Exports:
- `getHighlighter()` — returns `Promise<Highlighter>`
- `highlightCode(code: string, lang: string)` — returns `Promise<string>` (HTML)
- `detectLangFromPath(filePath: string)` — maps file extensions to shiki language IDs

Language map: ts/tsx → typescript, js/jsx → javascript, py → python, json, css, html, md → markdown, yaml/yml → yaml, rs → rust, go, sh/bash → bash. Default: `text`.

Theme: `github-dark` (dark background that complements TAI's `--bg-card`).

Falls back to plain `<pre><code>` if shiki fails or language not loaded.

**`src/components/ToolCallBody.tsx`**
Expandable body component rendered below tool header rows. Contains:

- `formatToolLabel(name: string, input: string)` — parses JSON input to extract display label:
  | Tool | Label | Example |
  |------|-------|---------|
  | Bash | `command` field | `npm run build` |
  | Read | `file_path` | `src/components/App.tsx` |
  | Write | `file_path` | `src/utils/helper.ts` |
  | Edit | `file_path` | `src/components/App.tsx` |
  | Grep | `pattern` + optional `path`/`type` | `"handleClick" · src/` |
  | Glob | `pattern` | `**/*.tsx` |
  | WebFetch | `url` | `https://example.com/api` |
  | WebSearch | `query` | `react shiki setup` |
  | Unknown | raw input (truncated) | `{"foo":"bar"}` |

  Try/catch wrapped — malformed input falls back to raw string.

- `ToolCallBody` component — renders the expanded content based on tool type:
  - **Bash**: monospace output text, error display with red icon if tool error detected
  - **Edit**: unified diff from `old_string`/`new_string`, syntax-highlighted via shiki using language from file extension
  - **Read**: syntax-highlighted output (file contents) based on file extension
  - **Write**: syntax-highlighted `content` field from input based on file extension
  - **Grep/Glob**: plain monospace output (file paths, matched lines)
  - **Unknown**: raw monospace output

- `truncateLines(text: string, max: number)` — returns `{ truncated, isTruncated, totalLines }`. Max = 20.

- "Show all (N lines)" / "Show less" toggle button when truncated.

**`src/components/ToolCallBody.module.css`**
Styles for expanded tool content:
- `.body` — bordered container (1px solid border-card, 6px border-radius, overflow hidden), margin 4px 0 6px
- `.codeBlock` — monospace text, 11px font, padding 8px 10px, dark background
- `.diffAdd` — green background (rgba(72, 100, 40, 0.35))
- `.diffDel` — red background (rgba(180, 60, 40, 0.25))
- `.diffMarker` — 1.5ch wide, muted color, user-select none
- `.showMore` — full-width button, border-top, accent color, 11px, hover highlight
- `.errorDisplay` — red text with icon, flex layout
- `.outputHeader` — "Output" label, uppercase, muted, 10px with letter-spacing
- Shiki `pre` overrides — transparent background, no margin, 10px 12px padding

### Modified Files

**`src/components/InlineAIBlock.tsx`**
- Import `ChevronRight`, `ChevronDown` from lucide-react
- Import `ToolCallBody` and `formatToolLabel`
- Single `useState<Set<string>>` tracking expanded tool IDs (toggled on click via `call.id`)
- Tool row becomes clickable: `cursor: pointer`, `onClick` toggles expanded
- Replace raw `call.input` display with `formatToolLabel(call.name, call.input)`
- Add chevron icon (▶/▼) at start of row — only shown when tool has output/input to expand
- When expanded, render `<ToolCallBody call={call} />` below the row
- Remove `direction: rtl` from tool input since smart labels don't need it

**`src/components/InlineAIBlock.module.css`**
- `.tool` gets `cursor: pointer` and hover state (`background: rgba(255,255,255,0.03)`, `border-radius: 4px`)
- `.toolChevron` — 10px, muted color, flex-shrink 0
- `.toolLabel` — replaces `.toolInput`, no RTL direction, same monospace + ellipsis truncation

### Unchanged

- `src/types.ts` — `AIToolCall` already has `output` and `error` fields
- Backend/IPC layer — output data already flows through
