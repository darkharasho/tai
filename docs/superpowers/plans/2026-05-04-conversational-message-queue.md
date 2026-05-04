# Conversational Message Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Queue follow-up user messages while the AI is mid-stream and drain them as a single combined turn when the current one finishes, replacing today's stop-and-restart behavior. Queued messages render as editable/removable chips inside the streaming AI block.

**Architecture:** App-side queue lives as React state in `TerminalSession`. The submit path no longer interrupts the in-flight turn; instead it appends to the queue. The `done` handler drains the queue by joining entries with `\n\n` and recursively calling `handleAIRequest`. Queue UI is a new `QueuedChip` component rendered inside the streaming `InlineAIBlock`. Pure helper functions (`joinQueuedPrompts`, `addQueuedPrompt`, `editQueuedPrompt`, `removeQueuedPrompt`) keep the queue logic unit-testable; the React/UI parts are verified manually.

**Tech Stack:** React 18, TypeScript, Vite, Vitest (node env, no React component tests in the repo). Existing CSS Modules pattern.

---

## File Structure

**New files:**
- `src/utils/queuedPrompts.ts` — pure helpers + `QueuedPrompt` type
- `src/components/QueuedChip.tsx` — chip with inline edit + remove
- `src/components/QueuedChip.module.css` — chip styles + fade animation
- `tests/unit/queuedPrompts.test.ts` — unit tests for the helpers

**Modified files:**
- `src/components/BlockList.tsx` — pass queue props to streaming `InlineAIBlock`
- `src/components/InlineAIBlock.tsx` — render queue region when streaming
- `src/components/InlineAIBlock.module.css` — queue row container styles
- `src/components/TerminalSession.tsx` — queue state, submit branching, drain on `done`, stop clears queue, error fallback to input

---

## Task 1: Pure helpers and type for the queue

**Files:**
- Create: `src/utils/queuedPrompts.ts`
- Create: `tests/unit/queuedPrompts.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/queuedPrompts.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  addQueuedPrompt,
  editQueuedPrompt,
  removeQueuedPrompt,
  joinQueuedPrompts,
} from '@/utils/queuedPrompts';

describe('queuedPrompts', () => {
  it('addQueuedPrompt appends a new entry with a unique id', () => {
    const a = addQueuedPrompt([], 'hello');
    expect(a).toHaveLength(1);
    expect(a[0].text).toBe('hello');
    expect(a[0].id).toBeTruthy();

    const b = addQueuedPrompt(a, 'world');
    expect(b).toHaveLength(2);
    expect(b[1].text).toBe('world');
    expect(b[0].id).not.toBe(b[1].id);
  });

  it('addQueuedPrompt ignores empty / whitespace-only text', () => {
    expect(addQueuedPrompt([], '')).toHaveLength(0);
    expect(addQueuedPrompt([], '   ')).toHaveLength(0);
    expect(addQueuedPrompt([], '\n\n')).toHaveLength(0);
  });

  it('editQueuedPrompt updates only the matching id', () => {
    const seed = addQueuedPrompt(addQueuedPrompt([], 'one'), 'two');
    const edited = editQueuedPrompt(seed, seed[0].id, 'ONE');
    expect(edited[0].text).toBe('ONE');
    expect(edited[1].text).toBe('two');
    expect(edited[0].id).toBe(seed[0].id);
  });

  it('editQueuedPrompt removes the entry when new text is empty', () => {
    const seed = addQueuedPrompt(addQueuedPrompt([], 'one'), 'two');
    const edited = editQueuedPrompt(seed, seed[0].id, '   ');
    expect(edited).toHaveLength(1);
    expect(edited[0].text).toBe('two');
  });

  it('removeQueuedPrompt drops only the matching id', () => {
    const seed = addQueuedPrompt(addQueuedPrompt([], 'one'), 'two');
    const next = removeQueuedPrompt(seed, seed[0].id);
    expect(next).toHaveLength(1);
    expect(next[0].text).toBe('two');
  });

  it('removeQueuedPrompt is a no-op for unknown ids', () => {
    const seed = addQueuedPrompt([], 'one');
    expect(removeQueuedPrompt(seed, 'nope')).toEqual(seed);
  });

  it('joinQueuedPrompts joins entries with double-newline', () => {
    const seed = addQueuedPrompt(addQueuedPrompt([], 'first'), 'second');
    expect(joinQueuedPrompts(seed)).toBe('first\n\nsecond');
  });

  it('joinQueuedPrompts returns empty string for an empty queue', () => {
    expect(joinQueuedPrompts([])).toBe('');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- queuedPrompts`
Expected: FAIL with "Cannot find module '@/utils/queuedPrompts'" (or equivalent).

- [ ] **Step 3: Implement the module**

Create `src/utils/queuedPrompts.ts`:

```ts
export type QueuedPrompt = {
  id: string;
  text: string;
};

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function addQueuedPrompt(queue: QueuedPrompt[], text: string): QueuedPrompt[] {
  if (!text.trim()) return queue;
  return [...queue, { id: newId(), text }];
}

export function editQueuedPrompt(
  queue: QueuedPrompt[],
  id: string,
  text: string,
): QueuedPrompt[] {
  if (!text.trim()) return removeQueuedPrompt(queue, id);
  return queue.map(q => (q.id === id ? { ...q, text } : q));
}

export function removeQueuedPrompt(queue: QueuedPrompt[], id: string): QueuedPrompt[] {
  return queue.filter(q => q.id !== id);
}

export function joinQueuedPrompts(queue: QueuedPrompt[]): string {
  return queue.map(q => q.text).join('\n\n');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- queuedPrompts`
Expected: PASS, all 8 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/utils/queuedPrompts.ts tests/unit/queuedPrompts.test.ts
git commit -m "feat(queue): add pure helpers for queued prompt list"
```

---

## Task 2: QueuedChip component

**Files:**
- Create: `src/components/QueuedChip.tsx`
- Create: `src/components/QueuedChip.module.css`

- [ ] **Step 1: Create the CSS module**

Create `src/components/QueuedChip.module.css`:

```css
.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  margin: 3px 4px 3px 0;
  background: rgba(183, 140, 255, 0.06);
  border: 1px dashed rgba(183, 140, 255, 0.35);
  border-radius: 12px;
  color: var(--text-primary);
  font-family: var(--font-sans);
  font-size: 12px;
  line-height: 1.4;
  max-width: 100%;
  cursor: text;
  transition: opacity 0.4s ease, transform 0.4s ease;
}

.chip:hover {
  background: rgba(183, 140, 255, 0.1);
  border-color: rgba(183, 140, 255, 0.5);
}

.icon {
  color: var(--color-ai);
  opacity: 0.7;
  flex-shrink: 0;
}

.text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  min-width: 0;
}

.input {
  background: transparent;
  border: none;
  outline: none;
  color: var(--text-primary);
  font: inherit;
  padding: 0;
  margin: 0;
  min-width: 60px;
  max-width: 600px;
  flex: 1;
}

.remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  padding: 0;
  margin: 0;
  color: var(--text-muted);
  opacity: 0.4;
  cursor: pointer;
  transition: opacity 0.15s;
  flex-shrink: 0;
}

.remove:hover {
  opacity: 0.9;
}
```

- [ ] **Step 2: Create the chip component**

Create `src/components/QueuedChip.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import styles from './QueuedChip.module.css';

interface QueuedChipProps {
  text: string;
  onSave: (text: string) => void;
  onRemove: () => void;
}

export function QueuedChip({ text, onSave, onRemove }: QueuedChipProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  useEffect(() => {
    if (!isEditing) setDraft(text);
  }, [text, isEditing]);

  const commit = () => {
    setIsEditing(false);
    if (draft !== text) onSave(draft);
  };

  const cancel = () => {
    setDraft(text);
    setIsEditing(false);
  };

  return (
    <span className={styles.chip}>
      <Sparkles size={11} className={styles.icon} />
      {isEditing ? (
        <input
          ref={inputRef}
          className={styles.input}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              cancel();
            }
          }}
        />
      ) : (
        <span
          className={styles.text}
          onClick={() => setIsEditing(true)}
          role="button"
          tabIndex={0}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setIsEditing(true);
            }
          }}
        >
          {text}
        </span>
      )}
      <button
        type="button"
        className={styles.remove}
        onClick={onRemove}
        aria-label="Remove queued message"
      >
        <X size={11} />
      </button>
    </span>
  );
}
```

- [ ] **Step 3: Verify the project still type-checks**

Run: `npm run build`
Expected: build succeeds (component is unused so far but compiles cleanly).

- [ ] **Step 4: Commit**

```bash
git add src/components/QueuedChip.tsx src/components/QueuedChip.module.css
git commit -m "feat(queue): add QueuedChip with inline edit and remove"
```

---

## Task 3: Render queue region inside InlineAIBlock

**Files:**
- Modify: `src/components/InlineAIBlock.tsx`
- Modify: `src/components/InlineAIBlock.module.css`

- [ ] **Step 1: Add queue row styles**

Append to `src/components/InlineAIBlock.module.css`:

```css
.queueRow {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid rgba(255, 255, 255, 0.04);
}

.queueLabel {
  color: var(--text-muted);
  font-family: var(--font-sans);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-right: 8px;
  opacity: 0.6;
}
```

- [ ] **Step 2: Update InlineAIBlock props and rendering**

Open `src/components/InlineAIBlock.tsx`. Find the props interface (around line 25-35 — the one that contains `question: string`). Add these optional props alongside the existing ones:

```ts
queuedPrompts?: { id: string; text: string }[];
onEditQueued?: (id: string, text: string) => void;
onRemoveQueued?: (id: string) => void;
```

Add the destructured props in the function signature alongside `question`, etc.:

```ts
queuedPrompts,
onEditQueued,
onRemoveQueued,
```

Add this import at the top of the file:

```ts
import { QueuedChip } from './QueuedChip';
```

Inside the rendered output, after the existing body content but still inside the AI card's `.inner` (i.e., before the closing tag of `.inner`/`.block`), add:

```tsx
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
```

If you cannot identify the closing tag location confidently, search for the last occurrence of `</div>` inside the component's return statement (the outermost wrapper) and place the snippet just before it — but confirm by reading lines 130-end of the file first.

- [ ] **Step 3: Build to confirm types are right**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/components/InlineAIBlock.tsx src/components/InlineAIBlock.module.css
git commit -m "feat(queue): render queue row inside streaming AI block"
```

---

## Task 4: Route queue props through BlockList

**Files:**
- Modify: `src/components/BlockList.tsx`

- [ ] **Step 1: Add queue props to BlockListProps**

In `src/components/BlockList.tsx`, edit the `BlockListProps` interface (lines 14-28). Add at the end of the interface:

```ts
queuedPrompts?: { id: string; text: string }[];
onEditQueued?: (id: string, text: string) => void;
onRemoveQueued?: (id: string) => void;
```

- [ ] **Step 2: Destructure the new props**

In the `BlockList` function signature destructure (around lines 30-44), add at the end (alongside `aiProvider`):

```ts
queuedPrompts,
onEditQueued,
onRemoveQueued,
```

- [ ] **Step 3: Pass props only to the streaming AI block**

In `src/components/BlockList.tsx` around lines 113-130 (the `if (item.type === 'ai')` branch), change the `<InlineAIBlock>` invocation to pass queue props only when `item.streaming` is true:

```tsx
<InlineAIBlock
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
/>
```

- [ ] **Step 4: Build to confirm**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/components/BlockList.tsx
git commit -m "feat(queue): pipe queue props through BlockList"
```

---

## Task 5: Queue state + submit branching in TerminalSession

**Files:**
- Modify: `src/components/TerminalSession.tsx`

- [ ] **Step 1: Add imports**

At the top of `src/components/TerminalSession.tsx`, add:

```ts
import {
  type QueuedPrompt,
  addQueuedPrompt,
  editQueuedPrompt,
  removeQueuedPrompt,
  joinQueuedPrompts,
} from '@/utils/queuedPrompts';
```

- [ ] **Step 2: Add queue state and ref**

Find an existing `useState` cluster near the top of the `TerminalSession` function body (e.g., near `displayItems`). Add:

```ts
const [queuedPrompts, setQueuedPrompts] = useState<QueuedPrompt[]>([]);
const queuedPromptsRef = useRef<QueuedPrompt[]>([]);

useEffect(() => {
  queuedPromptsRef.current = queuedPrompts;
}, [queuedPrompts]);
```

(Confirm `useRef` and `useEffect` are already imported at the top of the file; if either is missing add it to the existing `react` import.)

- [ ] **Step 3: Add queue mutator callbacks**

Just below the queue state, add:

```ts
const handleEditQueued = useCallback((id: string, text: string) => {
  setQueuedPrompts(prev => editQueuedPrompt(prev, id, text));
}, []);

const handleRemoveQueued = useCallback((id: string) => {
  setQueuedPrompts(prev => removeQueuedPrompt(prev, id));
}, []);
```

(Confirm `useCallback` is already imported.)

- [ ] **Step 4: Branch the submit path**

In `handleSubmit` (around line 346-377), change the `else` branch (currently `handleAIRequest(value)`) to check `aiWorking` first. The full updated `handleSubmit` should read:

```ts
const handleSubmit = useCallback((value: string) => {
  if (inputMode === 'shell') {
    const isMultiline = value.includes('\n');
    const display = isMultiline ? value : value.trim();
    const toRun = isMultiline
      ? `bash -c '${value.replace(/'/g, `'\\''`)}'`
      : value.trim();
    const pendingBlock = {
      id: 'pending',
      command: display,
      output: '',
      rawOutput: '',
      promptText: promptInfo?.text ?? '',
      startTime: Date.now(),
      duration: 0,
      isRemote: promptInfo?.isRemote ?? false,
    };
    pendingCommandRef.current = { command: display, startTime: Date.now() };
    setDisplayItems(prev => {
      const cleaned = prev.map(item =>
        item.type === 'command' && item.block.id === 'pending'
          ? { ...item, active: false, block: { ...item.block, id: `stale-${Date.now()}` } }
          : item
      );
      return [...cleaned, { type: 'command' as const, block: pendingBlock, active: true }];
    });
    executeCommand(toRun);
    setEditValue(undefined);
  } else if (aiWorking) {
    setQueuedPrompts(prev => addQueuedPrompt(prev, value));
    setEditValue('');
  } else {
    handleAIRequest(value);
  }
}, [inputMode, executeCommand, promptInfo, aiWorking, handleAIRequest]);
```

Note: `aiWorking` and `handleAIRequest` are now in the dependency array. Make sure both are in scope at this point in the file (they should be — `aiWorking` is defined at line 218, `handleAIRequest` at line 379). If `handleAIRequest` is defined *after* `handleSubmit`, leave the dep array as-is — JavaScript's hoisting via `useCallback` references is fine because callbacks are read at call time.

If your linter complains about ordering, swap so `handleAIRequest` is defined before `handleSubmit`, or wrap with a stable ref.

- [ ] **Step 5: Remove the stop-and-restart path from handleAIRequest**

In `handleAIRequest` (lines 379-393), delete the entire block that reads:

```ts
if (aiCleanupRef.current) {
  try { providerRef.current.stop(); } catch (err) { console.error('AI provider stop failed:', err); }
  try { aiCleanupRef.current(); } catch (err) { console.error('AI cleanup failed:', err); }
  const staleBlockId = aiBlockIdRef.current;
  if (staleBlockId) {
    setDisplayItems(prev => prev.map(item =>
      item.type === 'ai' && item.id === staleBlockId
        ? { ...item, streaming: false }
        : item
    ));
  }
  aiCleanupRef.current = null;
  aiBlockIdRef.current = null;
}
```

The function should now begin directly with `handleInputModeChange('ai');`. The queue path means we never call `handleAIRequest` while a turn is active for normal user submissions.

- [ ] **Step 6: Build to confirm**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/components/TerminalSession.tsx
git commit -m "feat(queue): queue messages while AI is busy instead of restarting"
```

---

## Task 6: Drain the queue on `done`

**Files:**
- Modify: `src/components/TerminalSession.tsx`

- [ ] **Step 1: Drain on done**

In `handleAIRequest`, find the `if (msg.type === 'done')` branch (around line 626-657). Two sub-branches exist: the `if (!gotContent)` early-return path and the normal completion path.

In **both** branches, immediately after the `cleanup();` call (inside `!gotContent`) and after the `finalize();` call (inside the normal path), add the drain logic. Wrap as a local helper at the top of `handleAIRequest` (just inside the function body, before `setDisplayItems(prev => [...prev, ...])`):

```ts
const drainQueue = () => {
  if (queuedPromptsRef.current.length > 0) {
    const combined = joinQueuedPrompts(queuedPromptsRef.current);
    setQueuedPrompts([]);
    queuedPromptsRef.current = [];
    handleAIRequest(combined);
  }
};
```

Then in the `!gotContent` branch, after `cleanup();` and before `return;`, add:

```ts
drainQueue();
```

In the normal `done` branch, after `finalize();` and after the `window.tai?.notify?.completion(...)` call, add:

```ts
drainQueue();
```

- [ ] **Step 2: Verify recursion is safe**

`handleAIRequest` calling itself via `drainQueue` works because `handleAIRequest` is a stable `useCallback`. Confirm by reading the function — there is no synchronous loop because `drainQueue` calls `handleAIRequest` once per drain, which sets up a new stream with its own `done` handler.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/components/TerminalSession.tsx
git commit -m "feat(queue): drain queue as combined turn when AI finishes"
```

---

## Task 7: Wire queue props into BlockList invocation

**Files:**
- Modify: `src/components/TerminalSession.tsx`

- [ ] **Step 1: Pass queue props to BlockList**

Find the `<BlockList ... />` invocation in `TerminalSession.tsx` (around line 825-842 — search for `onSendInput={handleSendInput}`). Add the three queue props alongside the existing ones:

```tsx
queuedPrompts={queuedPrompts}
onEditQueued={handleEditQueued}
onRemoveQueued={handleRemoveQueued}
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Smoke test the dev app manually**

Run: `npm run dev` (in another terminal). When the app launches:

1. Switch to AI mode, send a message (e.g., "count from 1 to 30 slowly").
2. While Claude is streaming, type "another question" and press Enter.
3. Confirm: input clears, a chip appears below the streaming AI content with "another question" and a ✕.
4. Type a third message and press Enter — second chip appears.
5. Click the first chip's text — it should become an inline input. Edit the text, press Enter.
6. Click the ✕ on the remaining chip — it should disappear.
7. Re-add a chip and let Claude finish on its own. Confirm: the chip fades out and a new user prompt appears with that text, and Claude starts a new turn responding to it.

If any step fails, do NOT continue to Task 8. Debug and fix before commit.

- [ ] **Step 4: Commit**

```bash
git add src/components/TerminalSession.tsx
git commit -m "feat(queue): connect queue state to BlockList rendering"
```

---

## Task 8: Stop button clears the queue

**Files:**
- Modify: `src/components/TerminalSession.tsx`

- [ ] **Step 1: Locate handleStopAI**

Search for `handleStopAI` in `src/components/TerminalSession.tsx`. There should be a callback that calls `providerRef.current.stop()` and cleans up streaming state.

- [ ] **Step 2: Clear the queue inside it**

Add `setQueuedPrompts([]);` to the body of `handleStopAI`, alongside the existing stop/cleanup logic. Also clear the ref defensively: `queuedPromptsRef.current = [];`.

If `handleStopAI` is wrapped in `useCallback`, no dep changes are needed (setters are stable).

- [ ] **Step 3: Manual test**

Run `npm run dev`. Send a message, queue 1-2 follow-ups while Claude streams, then click the Stop button on the AI card. Confirm the queue chips disappear along with the AI block stopping.

- [ ] **Step 4: Commit**

```bash
git add src/components/TerminalSession.tsx
git commit -m "feat(queue): clear queue when Stop is pressed"
```

---

## Task 9: Process error / cleanup falls queue back into input

**Files:**
- Modify: `src/components/TerminalSession.tsx`

- [ ] **Step 1: Identify error / unexpected cleanup paths**

In `handleAIRequest`, find the `msg.type === 'error'` branch (search for `'error'` near `entries.push({ kind: 'text', ...})`). Also find any provider/process exit handler that sets `streaming: false` outside the `done` path. Specifically look for messages of type `result` with `is_error`, or generic exit/disconnect handlers.

- [ ] **Step 2: Build a fallback helper**

Inside `handleAIRequest`, alongside the `drainQueue` helper from Task 6, add:

```ts
const fallbackQueueToInput = () => {
  if (queuedPromptsRef.current.length > 0) {
    const combined = joinQueuedPrompts(queuedPromptsRef.current);
    setQueuedPrompts([]);
    queuedPromptsRef.current = [];
    setEditValue(combined);
  }
};
```

- [ ] **Step 3: Call it from the error path**

In the error handling branch (where `errorText` is built and `entries.push({ kind: 'text', text: errorText });` is called), at the end of that branch — after `updateItem();` and `return;` — add:

```ts
fallbackQueueToInput();
```

If the function returns before reaching it, restructure so the fallback runs before the early `return`. Final structure:

```ts
if (msg.type === 'error' /* or whatever the existing condition is */) {
  // ... existing error handling that pushes errorText and updates the item ...
  updateItem();
  fallbackQueueToInput();
  return;
}
```

- [ ] **Step 4: Manual test**

Run `npm run dev`. Send an AI message; while it's streaming, queue a follow-up. Force an error (e.g., disconnect by killing the AI subprocess from a separate terminal: find the process started by `claude --output-format stream-json` and `kill` it). Confirm the queued message text drops back into the input box as a draft instead of vanishing.

If reproducing an error is difficult in dev, manually trigger the path by editing your local copy temporarily to call `fallbackQueueToInput()` and verify the input populates — then revert before commit.

- [ ] **Step 5: Commit**

```bash
git add src/components/TerminalSession.tsx
git commit -m "feat(queue): restore queued text to input on AI error"
```

---

## Task 10: Final verification

- [ ] **Step 1: Run the unit suite**

Run: `npm test`
Expected: all tests pass, including the new `queuedPrompts.test.ts`.

- [ ] **Step 2: Run the build**

Run: `npm run build`
Expected: build succeeds with no TypeScript errors.

- [ ] **Step 3: End-to-end manual smoke**

Run `npm run dev`. Walk through this scenario:

1. Send "explain the rpm-ostree command in 3 paragraphs" (slow response).
2. Mid-stream, send "and also describe what bazzite is".
3. Mid-stream, send "and what does mesa do".
4. Confirm both chips appear inside the streaming card.
5. Edit chip 1 to "and also describe bazzite briefly". Remove chip 2.
6. Wait for Claude to finish.
7. Confirm a single user prompt line appears reading the joined remaining chip text, and Claude starts a new turn responding to it.
8. While that new turn is streaming, press Stop. Confirm the AI stops and any queue is empty.

- [ ] **Step 4: No commit needed**

Verification only — no files changed.

---

## Self-Review Notes

Coverage check against `docs/superpowers/specs/2026-05-04-conversational-message-queue-design.md`:
- Submit branching → Task 5
- Drain path → Task 6
- Queue UI rendering → Tasks 2-4
- Editable + removable chips → Task 2
- Transition (fade + new prompt line) → CSS in Task 2 (chip transition) + drain in Task 6 (new prompt appears via existing `InlineAIBlock` render of the new turn)
- Stop button clears queue → Task 8
- Process error fallback to input → Task 9
- Empty submit ignored → Task 1 (`addQueuedPrompt` returns queue unchanged for empty/whitespace text)
- Shell mode unchanged → Task 5 (preserved the shell branch verbatim)
- Tool approval coexistence → no special handling needed; queue rendering is independent of approval prompts (manual smoke test in Task 10 step 3 stresses this)
- Tab switching → no changes; queue lives in `TerminalSession` state which already follows tab lifecycle
