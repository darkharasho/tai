# Conversational Message Queue — Design

## Problem

When the AI is mid-stream and the user submits a follow-up message, the current `handleAIRequest` in `src/components/TerminalSession.tsx:379-393` calls `provider.stop()` + cleanup on the in-flight turn and starts a fresh turn with only the new prompt. This kills the prior generation and discards conversational momentum, making multi-message sessions feel broken (see the bazzite/`hello?` case where the second message lands on a spinning Claude that no longer addresses either prompt).

## Goal

Make multi-message input feel conversational. While the AI is working, queue subsequent user messages and send them as the next turn once the current one finishes. The user can still see, edit, and remove queued messages before they're sent. Behavior is uniform across providers (Claude, Codex, Gemini).

## Architecture

### State (in `TerminalSession.tsx`)

Add a single source of truth for queued messages:

```ts
type QueuedPrompt = { id: string; text: string };

const [queuedPrompts, setQueuedPrompts] = useState<QueuedPrompt[]>([]);
const queuedPromptsRef = useRef<QueuedPrompt[]>([]);
// keep ref in sync via setter wrapper or useEffect
```

`queuedPrompts` drives rendering. `queuedPromptsRef` exists so the drain callback (fired from inside the AI message stream) reads the latest queue without stale-closure problems.

Each entry has a stable `id` (e.g. `nanoid` or `crypto.randomUUID()`) so editing or removing one chip doesn't disturb the React keys of the others.

### Submit path

Modify `handleSubmit` (line 346) and `handleAIRequest` (line 379):

- If `inputMode === 'ai'` AND `aiWorking` is true: push `{ id, text: value }` onto the queue, clear the input, return. Do NOT call `provider.stop()` / cleanup / send. The current turn continues uninterrupted.
- If `inputMode === 'ai'` AND `aiWorking` is false: existing behavior — start a new turn via `handleAIRequest`.
- `inputMode === 'shell'`: unchanged.
- The `aiCleanupRef`-based "stop and restart" logic at lines 380-393 is removed. There is no longer a path where submitting a new prompt while busy interrupts the current turn.

### Drain path

In the existing `done` handler inside `handleAIRequest` (around line 626), after the existing finalize/cleanup/`handleInputModeChange('shell')` block, check the queue:

```ts
if (queuedPromptsRef.current.length > 0) {
  const combined = queuedPromptsRef.current.map(q => q.text).join('\n\n');
  setQueuedPrompts([]);
  queuedPromptsRef.current = [];
  handleAIRequest(combined);
}
```

The drained text is sent as a single new turn. The "fade chips → render prompt line" transition is driven by the same state change: chips animate out as `queuedPrompts` becomes empty, and the new `InlineAIBlock` for the next turn (with `question = combined`) renders in approximately the same vertical position.

### Stop button

`handleStopAI` clears the queue in addition to stopping the AI process. The user pressing Stop is an explicit "I'm done with this input thread" signal. No restoration prompt — if they want any of those messages, they can re-type from the input.

### Provider error / cleanup edge case

If the AI process exits with an error or unexpected cleanup with a non-empty queue:

- Don't auto-send the queued messages on a failed transport.
- Drop the joined queue text into the input box as draft (`setEditValue(combined)`).
- Clear the queue.

Simplest path; no special restoration UI.

## UI

### Queue rendering

A new component (or inline JSX inside `InlineAIBlock.tsx`) renders below the streaming AI content, only when both `streaming === true` and the parent's `queuedPrompts.length > 0`:

```tsx
<div className={styles.queueRow}>
  {queuedPrompts.map(q => (
    <QueuedChip
      key={q.id}
      text={q.text}
      onEdit={(newText) => onEditQueued(q.id, newText)}
      onRemove={() => onRemoveQueued(q.id)}
    />
  ))}
</div>
```

Props pass down from `TerminalSession` through `BlockList` to the streaming `InlineAIBlock`. Only the currently streaming AI block renders the queue region — historical AI blocks ignore queue state.

### Chip styling

Match the existing `--color-ai` purple aesthetic from `InlineAIBlock.module.css`:

- Sparkle icon (`Sparkles` from `lucide-react`, same as `.promptIcon`) at left, tinted `--color-ai`.
- Dashed 1px border `rgba(183, 140, 255, 0.35)` (or equivalent var-derived alpha).
- Background `rgba(183, 140, 255, 0.06)`.
- Border-radius 12px (pill shape).
- Padding `4px 10px`, font-size 12px, color `--text-primary`.
- ✕ icon at right, opacity 0.4, hover 0.8.
- Margin `3px 4px 3px 0` so chips wrap naturally with breathing room.

### Editing

Click the chip's text region → text becomes a single-line input pre-filled with the current text. Enter saves (calls `onEditQueued`), Escape cancels and reverts. ✕ remains visible during edit. Empty save = remove. Use a small local `isEditing` state on the chip; no global state needed.

### Removal

Click ✕ → calls `onRemoveQueued(id)` which filters the queue array.

## Transition (drain animation)

When `done` fires and the queue has content, two coordinated changes happen:

1. `setQueuedPrompts([])` clears the chips. Chips animate out: `opacity 1 → 0` and `translateY(0 → -8px)` over 400ms via CSS transitions on the chip container.
2. `handleAIRequest(combined)` runs immediately, which appends a new AI display item with `question = combined`. The new `InlineAIBlock` renders below; its prompt line (sparkle + question text) appears in approximately the same vertical position the chips occupied. A maxHeight/opacity entrance transition with a 250ms delay produces a crossfade.

No explicit FLIP animation needed — the visual continuity comes from the matching sparkle icon, color, and approximate position. The chips' `display` is conditional on `queuedPrompts.length > 0`, so they unmount cleanly after their fade transition completes (use `onTransitionEnd` or simply an `setTimeout`-gated unmount).

## Edge cases

- Empty submit while busy: ignored (same as today).
- User in `shell` mode while AI busy: queue does not engage. Shell submits run normally.
- Tool approval pending mid-turn (`streaming: true`, awaiting `ai:approve`): queueing still works. Approval prompt and queue chips coexist visually inside the same streaming card. When the user approves/rejects and the turn eventually fires `done`, the queue drains as usual.
- Multiple very long queued messages: the join uses `\n\n` so the combined prompt remains readable.
- Process crash with non-empty queue: combined text drops into the input as draft (see "Provider error / cleanup edge case" above).
- Switching tabs while a tab has queued messages: queue belongs to the tab's `TerminalSession` instance and persists across tab switches as long as the tab is mounted.

## Out of scope for v1

- Reordering queued chips via drag.
- Per-provider stdin interjection (e.g., writing to Claude's stream-json stdin while a turn is mid-flight). The app-side queue is uniform across providers and gives the user visible control; provider-side queueing would hide the chips.
- A "send now" affordance that interrupts the current turn and merges the queue with the input. Stop button + retype is the escape hatch.

## Files touched

- `src/components/TerminalSession.tsx` — queue state, submit-path branching, drain on `done`, stop-button clears queue, error fallback to input.
- `src/components/InlineAIBlock.tsx` — render queue region when streaming, accept queue props.
- `src/components/InlineAIBlock.module.css` — chip styling, fade animation.
- `src/components/BlockList.tsx` — pass queue props through to the streaming `InlineAIBlock`.
- `src/components/QueuedChip.tsx` (new) — chip component with inline edit + remove.
- `src/components/QueuedChip.module.css` (new) — chip-specific styles, or merged into `InlineAIBlock.module.css`.

## Testing notes

- Manual: send msg → as Claude streams, send 2 more msgs → confirm chips appear, edit one, remove one, wait for `done` → confirm combined message becomes the next user prompt and Claude responds to both points.
- Manual: send msg → stream → submit a queued msg → press Stop → confirm queue clears and AI stops.
- Manual: queue chips, then trigger an AI process error (kill from outside or invalid model) → confirm queue text lands in the input as draft.
- Manual: tool approval flow with queued chips → confirm chips remain visible, approval still works, drain happens after final `done`.
