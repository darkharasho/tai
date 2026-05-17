# AI Prompt Thread Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the floating sparkle-iconed prompt above the AI card with a "conversation" wrapper: consecutive AI exchanges share one soft gradient rail with green/purple endpoint dots; follow-up turns get a `↪ YOU` label.

**Architecture:** Pure UI/markup change. `BlockList` gains a grouping pass that wraps runs of adjacent `'ai'` items in a new `<AIConversation>` wrapper. `InlineAIBlock` drops its per-block prompt icon and accepts an `isFollowup` prop that drives the label text.

**Tech Stack:** React + TypeScript, CSS Modules, Vitest (for the grouping function unit test).

**Spec:** `docs/superpowers/specs/2026-05-16-ai-prompt-thread-design.md`

---

## File Structure

**New:**
- `src/components/AIConversation.tsx` — wrapper component (rail + endpoint dots + children).
- `src/components/AIConversation.module.css` — wrapper-only styles.
- `src/utils/groupConversations.ts` — pure grouping helper.
- `tests/unit/groupConversations.test.ts` — unit test for grouping.

**Modified:**
- `src/components/InlineAIBlock.tsx` — drop `Sparkles`, add `isFollowup` prop, render `YOU` / `↪ YOU` label.
- `src/components/InlineAIBlock.module.css` — drop `.promptIcon`, restyle `.prompt`/`.promptText`, add `.promptLabel` + `.promptLabelFollowup`.
- `src/components/BlockList.tsx` — replace the `items.map` pass with a grouping pass that wraps adjacent `'ai'` items in `<AIConversation>`.

---

## Task 1: Grouping helper + tests

**Files:**
- Create: `src/utils/groupConversations.ts`
- Test: `tests/unit/groupConversations.test.ts`

The grouping helper is a pure function: given the `DisplayItem[]` array from `BlockList`, return a list of "groups" where each group is either a single non-AI item or a run of one or more consecutive AI items.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/groupConversations.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { groupConversations, type ConversationGroup } from '@/utils/groupConversations';
import type { DisplayItem } from '@/components/BlockList';

function ai(id: string): DisplayItem {
  return { type: 'ai', id, question: 'q', content: '', suggestedCommands: [], streaming: false };
}

function cmd(id: string): DisplayItem {
  // Minimal shape — groupConversations only inspects `type`.
  return { type: 'command', block: { id } as any };
}

function approval(id: string): DisplayItem {
  return { type: 'approval', id, command: 'rm', toolUseId: 't', toolName: 'Bash', status: 'pending' };
}

describe('groupConversations', () => {
  it('returns an empty array for no items', () => {
    expect(groupConversations([])).toEqual([]);
  });

  it('wraps a single AI item in a conversation group of size 1', () => {
    const items = [ai('a1')];
    const groups: ConversationGroup[] = groupConversations(items);
    expect(groups).toHaveLength(1);
    expect(groups[0].kind).toBe('conversation');
    if (groups[0].kind === 'conversation') {
      expect(groups[0].items).toHaveLength(1);
      expect(groups[0].items[0].id).toBe('a1');
    }
  });

  it('groups consecutive AI items into one conversation', () => {
    const items = [ai('a1'), ai('a2'), ai('a3')];
    const groups = groupConversations(items);
    expect(groups).toHaveLength(1);
    expect(groups[0].kind).toBe('conversation');
    if (groups[0].kind === 'conversation') {
      expect(groups[0].items.map(i => i.id)).toEqual(['a1', 'a2', 'a3']);
    }
  });

  it('breaks a conversation when a non-AI item appears between AI items', () => {
    const items = [ai('a1'), cmd('c1'), ai('a2')];
    const groups = groupConversations(items);
    expect(groups).toHaveLength(3);
    expect(groups[0].kind).toBe('conversation');
    expect(groups[1].kind).toBe('passthrough');
    expect(groups[2].kind).toBe('conversation');
  });

  it('treats approval items as conversation breakers', () => {
    const items = [ai('a1'), approval('p1'), ai('a2')];
    const groups = groupConversations(items);
    expect(groups.map(g => g.kind)).toEqual(['conversation', 'passthrough', 'conversation']);
  });

  it('handles a mixed sequence end-to-end', () => {
    // cmd, ai, ai, cmd, ai, approval, ai, ai
    const items = [
      cmd('c1'),
      ai('a1'), ai('a2'),
      cmd('c2'),
      ai('a3'),
      approval('p1'),
      ai('a4'), ai('a5'),
    ];
    const groups = groupConversations(items);
    expect(groups.map(g => g.kind)).toEqual([
      'passthrough',
      'conversation',
      'passthrough',
      'conversation',
      'passthrough',
      'conversation',
    ]);
    const sizes = groups.map(g => g.kind === 'conversation' ? g.items.length : 1);
    expect(sizes).toEqual([1, 2, 1, 1, 1, 2]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run --config tests/vitest.config.ts tests/unit/groupConversations.test.ts
```

Expected: FAIL — `Cannot find module '@/utils/groupConversations'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/utils/groupConversations.ts`:

```ts
import type { DisplayItem } from '@/components/BlockList';

export type ConversationGroup =
  | { kind: 'conversation'; items: Array<Extract<DisplayItem, { type: 'ai' }>> }
  | { kind: 'passthrough'; item: DisplayItem };

export function groupConversations(items: DisplayItem[]): ConversationGroup[] {
  const groups: ConversationGroup[] = [];
  let currentAi: Array<Extract<DisplayItem, { type: 'ai' }>> | null = null;

  for (const item of items) {
    if (item.type === 'ai') {
      if (currentAi === null) {
        currentAi = [];
        groups.push({ kind: 'conversation', items: currentAi });
      }
      currentAi.push(item);
    } else {
      currentAi = null;
      groups.push({ kind: 'passthrough', item });
    }
  }

  return groups;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run --config tests/vitest.config.ts tests/unit/groupConversations.test.ts
```

Expected: PASS — all 6 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/utils/groupConversations.ts tests/unit/groupConversations.test.ts
git commit -m "feat: add groupConversations helper for AI thread wrapping"
```

---

## Task 2: AIConversation wrapper component

**Files:**
- Create: `src/components/AIConversation.tsx`
- Create: `src/components/AIConversation.module.css`

The wrapper provides the visual conversation container — left padding, single gradient rail, two endpoint dots. It renders children as-is (the parent passes pre-built `InlineAIBlock` elements).

- [ ] **Step 1: Create the CSS module**

Create `src/components/AIConversation.module.css`:

```css
.conversation {
  position: relative;
  padding-left: 22px;
  margin: 6px 0 10px;
}

.rail {
  position: absolute;
  left: 7px;
  top: 6px;
  bottom: 6px;
  width: 3px;
  border-radius: 2px;
  background: linear-gradient(
    to bottom,
    rgba(0, 168, 132, 0.75) 0%,
    rgba(139, 92, 246, 0.75) 100%
  );
  pointer-events: none;
}

.dot {
  position: absolute;
  left: 4px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  border: 2px solid var(--bg-base);
  box-sizing: border-box;
  pointer-events: none;
}

.dotUser {
  top: 4px;
  background: var(--color-shell);
}

.dotAi {
  bottom: 4px;
  background: var(--color-ai);
}
```

- [ ] **Step 2: Create the component**

Create `src/components/AIConversation.tsx`:

```tsx
import type { ReactNode } from 'react';
import styles from './AIConversation.module.css';

interface AIConversationProps {
  children: ReactNode;
}

export function AIConversation({ children }: AIConversationProps) {
  return (
    <div className={styles.conversation}>
      <div className={styles.rail} aria-hidden="true" />
      <span className={`${styles.dot} ${styles.dotUser}`} aria-hidden="true" />
      <span className={`${styles.dot} ${styles.dotAi}`} aria-hidden="true" />
      {children}
    </div>
  );
}
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/AIConversation.tsx src/components/AIConversation.module.css
git commit -m "feat: add AIConversation wrapper with gradient rail and endpoint dots"
```

---

## Task 3: Update InlineAIBlock to drop the sparkle icon and render YOU / ↪ YOU label

**Files:**
- Modify: `src/components/InlineAIBlock.tsx:5,29-43,142-153`
- Modify: `src/components/InlineAIBlock.module.css:1-89`

The block stops drawing its own prompt-row icon; instead it renders a label above the prompt body. The wrapper loses its outer margin (the new `AIConversation` provides spacing).

- [ ] **Step 1: Remove `Sparkles` import**

In `src/components/InlineAIBlock.tsx` line 5, change:

```ts
import { Terminal, Copy, Sparkles, Square, Check, X, Circle, FileText, Pencil, FolderSearch, Search, Globe, ChevronRight, ChevronDown, type LucideIcon } from 'lucide-react';
```

to:

```ts
import { Terminal, Copy, Square, Check, X, Circle, FileText, Pencil, FolderSearch, Search, Globe, ChevronRight, ChevronDown, type LucideIcon } from 'lucide-react';
```

- [ ] **Step 2: Add `isFollowup` prop to the interface**

In `src/components/InlineAIBlock.tsx`, modify the `InlineAIBlockProps` interface (currently lines 29–43) to add a new field:

```ts
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
```

- [ ] **Step 3: Destructure `isFollowup` in the component signature**

In `src/components/InlineAIBlock.tsx` line 62–76, add `isFollowup = false,` to the destructured props (after `onRemoveQueued`):

```tsx
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
```

- [ ] **Step 4: Replace the prompt block markup**

In `src/components/InlineAIBlock.tsx`, replace the existing `{question && (...)} ` block (currently lines 144–153):

```tsx
      {question && (
        <div className={styles.prompt}>
          <Sparkles size={13} className={styles.promptIcon} />
          <div className={styles.promptText}>
            <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>
              {question}
            </ReactMarkdown>
          </div>
        </div>
      )}
```

with:

```tsx
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
```

- [ ] **Step 5: Update the CSS**

In `src/components/InlineAIBlock.module.css`, replace lines 1–18 (the `.wrapper`, `.prompt`, `.promptIcon` rules) with:

```css
.wrapper {
  margin: 0 0 14px;
}

.wrapper:last-child {
  margin-bottom: 0;
}

.prompt {
  display: block;
  padding: 4px 0 6px;
  margin-bottom: 4px;
}

.promptLabel {
  display: block;
  font-family: var(--font-sans);
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-shell);
  margin-bottom: 2px;
}

.promptLabelFollowup {
  /* same colour and size — class exists for future tweaks (e.g. lower opacity) */
}
```

Leave `.promptText` and everything else in the file unchanged.

- [ ] **Step 6: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/InlineAIBlock.tsx src/components/InlineAIBlock.module.css
git commit -m "feat: replace sparkle icon with YOU label and add isFollowup prop"
```

---

## Task 4: Wire grouping into BlockList

**Files:**
- Modify: `src/components/BlockList.tsx:1-7,96-168`

Replace the flat `items.map` pass with one that walks `groupConversations(items)` and wraps each conversation group in `<AIConversation>`. Inside the wrapper, each turn renders an `<InlineAIBlock>` with `isFollowup` set for everything after the first.

- [ ] **Step 1: Add imports**

In `src/components/BlockList.tsx`, modify the imports (currently lines 1–7) to include the new helpers:

```tsx
import { useRef, useEffect, useState, useCallback } from 'react';
import { Wrench, Check, X } from 'lucide-react';
import { CommandBlock } from './CommandBlock';
import { InlineAIBlock } from './InlineAIBlock';
import { AIConversation } from './AIConversation';
import { ApprovalPrompt } from './ApprovalPrompt';
import type { SegmentedBlock, AIEntry, AIProvider } from '@/types';
import { groupConversations } from '@/utils/groupConversations';
import styles from './BlockList.module.css';
```

(Leave `ApprovalPrompt` import as-is even if unused — that's pre-existing.)

- [ ] **Step 2: Extract the per-item render into a local helper**

In `src/components/BlockList.tsx`, immediately before the `return (` statement (around line 76), add a helper function inside the `BlockList` component body so it has access to all closure values:

```tsx
  function renderItem(item: DisplayItem, opts: { isFollowup?: boolean } = {}) {
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
            onSendInput={(item.active || id === activeBlockId) ? onSendInput : undefined}
          />
        </div>
      );
    }

    if (item.type === 'ai') {
      return (
        <InlineAIBlock
          key={item.id}
          question={item.question}
          content={item.content}
          suggestedCommands={item.suggestedCommands}
          streaming={item.streaming}
          duration={item.duration}
          entries={item.entries}
          onRunCommand={onRunSuggested}
          onCopy={onCopy}
          onStop={item.streaming ? onStopAI : undefined}
          aiProvider={aiProvider}
          queuedPrompts={item.streaming ? queuedPrompts : undefined}
          onEditQueued={item.streaming ? onEditQueued : undefined}
          onRemoveQueued={item.streaming ? onRemoveQueued : undefined}
          isFollowup={opts.isFollowup}
        />
      );
    }

    if (item.type === 'approval') {
      return (
        <div key={item.id}>
          <div className={`${styles.toolApproval}${item.status !== 'pending' ? ` ${styles.toolResolved}` : ''}`}>
            <div className={styles.toolApprovalHeader}>
              <span className={styles.toolApprovalLabel}>
                <span style={{ display: 'inline-flex', verticalAlign: 'middle', marginRight: 4 }}>
                  <Wrench size={12} />
                </span>
                {item.toolName}
              </span>
              {item.status === 'approved' && <span className={`${styles.toolStatus} ${styles.toolApproved}`}><Check size={12} /> allowed</span>}
              {item.status === 'rejected' && <span className={`${styles.toolStatus} ${styles.toolRejected}`}><X size={12} /> denied</span>}
            </div>
            <div className={styles.toolApprovalCommand}>{item.command}</div>
            {item.status === 'pending' && (
              <div className={styles.toolApprovalActions}>
                <button className={`${styles.toolBtn} ${styles.toolBtnApprove}`} onClick={() => onToolApprove(item as DisplayItem & { type: 'approval' })}>Allow</button>
                <button className={`${styles.toolBtn} ${styles.toolBtnDeny}`} onClick={() => onToolReject(item as DisplayItem & { type: 'approval' })}>Deny</button>
              </div>
            )}
          </div>
        </div>
      );
    }

    return null;
  }
```

- [ ] **Step 3: Replace the items.map block**

In `src/components/BlockList.tsx`, replace the entire existing `{items.map((item) => { … })}` block (currently lines 96–168) with:

```tsx
      {groupConversations(items).map((group, idx) => {
        if (group.kind === 'passthrough') {
          return renderItem(group.item);
        }
        const key = group.items.map(i => i.id).join('|') || `conv-${idx}`;
        return (
          <AIConversation key={key}>
            {group.items.map((aiItem, i) => renderItem(aiItem, { isFollowup: i > 0 }))}
          </AIConversation>
        );
      })}
```

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Run the full unit test suite**

```bash
npm test
```

Expected: all tests pass — including the new `groupConversations` tests; the existing suite is unaffected.

- [ ] **Step 6: Commit**

```bash
git add src/components/BlockList.tsx
git commit -m "feat: group adjacent AI items into AIConversation wrappers"
```

---

## Task 5: Manual visual verification

**Files:** none (run-only).

Launch the dev build and walk through every scenario from the spec's Testing section. This is the only way to verify presentational changes — no automated coverage replaces it.

- [ ] **Step 1: Start the app**

```bash
npm run dev
```

Wait for Vite + Electron to launch.

- [ ] **Step 2: Verify single-turn rendering**

Ask any AI question (e.g. `what time is it`). Confirm:

- A green dot sits at the top-left of the conversation.
- A purple dot sits at the bottom-left of the AI card.
- A single soft gradient rail runs from green → purple along the left edge.
- The label above the prompt reads `YOU` in uppercase shell-green, with no sparkle icon.
- The AI card itself is visually unchanged (accent border, header, body, footer all as before).

- [ ] **Step 3: Verify multi-turn conversation**

Ask a follow-up question with no shell command in between (e.g. ask AI a question, then ask AI another). Confirm:

- Both turns share one conversation wrapper — single rail, single pair of endpoint dots.
- The first turn's label reads `YOU`; the second turn's label reads `↪ YOU`.
- Spacing between turns is comfortable (~14px), not cramped or excessive.

- [ ] **Step 4: Verify a shell command breaks the conversation**

Sequence: AI question → run a shell command (e.g. `ls`) → AI question. Confirm:

- Two distinct conversation wrappers render, each with its own pair of endpoint dots.
- The second AI question's label reads `YOU`, not `↪ YOU`.

- [ ] **Step 5: Verify streaming + tool calls**

Ask an AI question that triggers tool calls and watch it stream. Confirm:

- Rail appears immediately when the prompt is submitted.
- Streaming dot in the card header animates as before.
- Expanded tool calls extend the card; the rail keeps pace with the card's full height.
- Bottom purple dot stays anchored to the bottom of the conversation.

- [ ] **Step 6: Verify queued prompts**

While an AI response is streaming, queue another prompt. Confirm queued chips render in their existing location (inside the streaming block) without colliding with the rail or dots.

- [ ] **Step 7: Verify long / markdown prompts**

Submit a multi-paragraph prompt with a code fence. Confirm `.promptText` markdown styles (code blocks, lists, links) still render correctly under the new `YOU` label.

- [ ] **Step 8: Commit a screenshot (optional, recommended)**

If anything looks off, fix in place and re-verify before declaring complete. No commit required for verification itself.

---

## Self-Review Notes

- **Spec coverage:** Tasks 1–4 cover all components listed in spec's "Files Affected". Task 5 covers all 7 test scenarios in spec's "Testing" section.
- **Edge cases:** Empty `question` is handled because the existing `{question && ...}` guard is preserved in Task 3 Step 4. Empty `items` returns `[]` from `groupConversations` (covered by Task 1 test). Conversation broken by shell command is covered by Task 1 test 4 and Task 5 Step 4.
- **No new dependencies, no data-model changes, no streaming changes** — risk is contained to presentational React.
