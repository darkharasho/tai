# AI Prompt + Response Thread Redesign

**Date:** 2026-05-16
**Components:** `src/components/InlineAIBlock.tsx`, `src/components/BlockList.tsx`
**Status:** Approved design — ready for implementation plan

## Problem

The user's prompt currently renders as a floating line of text with only a small sparkle icon above the AI response card. There is no clear visual signal that the prompt and the card below belong to the same exchange — and consecutive AI exchanges (a question, an answer, a follow-up) render as fully disconnected blocks, with no indication they're part of one conversation.

## Goal

Make each AI exchange read as one conversational turn, and make consecutive turns read as one continuous conversation — while keeping the AI response card as the primary artifact.

## Design

A single "conversation" wraps any run of adjacent AI items in `BlockList`. The conversation is anchored visually by a soft gradient rail down its left side, with small endpoint dots. Each turn inside the conversation shows a "You" label above the prompt; turns after the first get a "↪" prefix to mark them as follow-ups.

A non-AI item (shell command, approval prompt) between two AI items breaks the conversation — they render as two separate conversations.

### Layout

```
┌─ 22px left padding ─┐
│ ●  YOU              │   ← shell-green endpoint dot
│ ┃  how does the segmenter handle backpressure?
│ ┃  ┌──────────────────────────────────────┐
│ ┃  │ ✦ Claude · 2.4s                      │
│ ┃  │ Pauses node-pty above 64KB…         │
│ ┃  └──────────────────────────────────────┘
│ ┃
│ ┃  ↪ YOU
│ ┃  and where are those thresholds set?
│ ┃  ┌──────────────────────────────────────┐
│ ┃  │ ✦ Claude · 1.8s                      │
│ ┃  │ In electron/pty.ts near the write…  │
│ ┃  └──────────────────────────────────────┘
│ ┃
│ ┃  ↪ YOU
│ ┃  show me
│ ┃  ┌──────────────────────────────────────┐
│ ┃  │ ✦ Claude · 0.9s                      │
│ ●  │ Lines 142–158…                       │
│    └──────────────────────────────────────┘
```

### Conversation container (new)

A new `AIConversation` component (in `InlineAIBlock.tsx` or its own file) wraps one or more consecutive `InlineAIBlock` renders:

```jsx
<div className={styles.conversation}>
  <div className={styles.conversationRail} />
  <span className={styles.dotUser} />        {/* top, shell-green */}
  <span className={styles.dotAi} />          {/* bottom, AI-purple */}
  {turns.map((turn, i) => (
    <InlineAIBlock key={turn.id} {...turn} isFollowup={i > 0} />
  ))}
</div>
```

- **Wrapper** (`.conversation`): `position: relative; padding-left: 22px;`
- **Rail** (`.conversationRail`): `position: absolute; left: 7px; top: 6px; bottom: 6px; width: 3px; border-radius: 2px; background: linear-gradient(to bottom, rgba(0,168,132,0.75) 0%, rgba(139,92,246,0.75) 100%);`
- **Endpoint dots** (`.dotUser`, `.dotAi`): 8×8px circles at `left: 5px`, 2px border using `var(--bg-surface)`. Green dot at `top: 4px`, purple dot at `bottom: 4px`. No glow, no per-turn dots.

### Turn (modified `InlineAIBlock`)

Each turn renders without its own rail or dots — those belong to the conversation wrapper now. The block keeps its prompt label and AI card, with a new `isFollowup` prop:

- **First turn:** prompt label reads `YOU` (color `var(--color-shell)`, 10px uppercase letter-spaced, 500 weight).
- **Follow-up turns:** prompt label reads `↪ YOU` (same styling; the arrow uses the same color).
- **Turn spacing:** `margin-bottom: 14px` between turns inside a conversation; `0` on the last turn.
- **Prompt card:** the prompt label + body live inside a small elevated card — `background: var(--bg-elevated)`, `border-left: 3px solid var(--color-shell)`, `border-radius: 12px`, `padding: 9px 14px`, with a subtle inset highlight. Deliberately distinct from the command card pattern (which uses corner accents on `bg-card`).
- **AI card:** unchanged from today (existing `.block`/`.accent`/`.header`/`.body` structure).
- **`Sparkles` import:** removed; replaced by the text label.

### Grouping logic (`BlockList`)

Today `BlockList` maps `items: DisplayItem[]` 1:1 to component renders. Change to: before rendering, walk the array and produce groups, where each group is either:

- A single non-AI item (`command` or `approval`) — rendered as today.
- A run of one or more consecutive AI items — rendered inside one `AIConversation` wrapper.

Adjacency is defined by index in `items` only — no shell command, approval prompt, or other DisplayItem may sit between two AI items in the same conversation. The grouping is a pure function of `items`; no new state.

### Edge cases

- **Single-turn conversation:** Renders identically to a multi-turn conversation with one turn. The rail has both endpoint dots and the gradient still flows green → purple.
- **No question (rare AI item with empty `question`):** Skip the prompt label and body; render only the AI card inside the conversation. The top endpoint dot remains (green), since the conversation as a whole is initiated by the user.
- **Streaming on the last turn:** Rail and dots render immediately when the turn is added; the AI card appears as it streams, same as today. The bottom purple endpoint dot sits at `bottom: 4px` of the conversation — if the card is still mounting, the dot anchors to the wrapper's current bottom.
- **Long / multi-line prompts, markdown code fences:** Existing `.promptText` (renamed `.promptBody`) styles preserved.
- **Queued prompts (`queuedPrompts`):** Unchanged — they continue to render as `QueuedChip`s on the active block. Queued prompts are not part of the threaded rail.
- **Conversation broken by a shell command:** Two separate `.conversation` wrappers render, each with its own pair of endpoint dots.

### What does NOT change

- The AI card itself (`.block`, `.accent`, `.header`, `.body`, footer) — colors, content, tool call rendering, copy buttons, stop button, duration display.
- `BlockSegmenter`, the AI entry data model, streaming behavior, scroll behavior.
- `AgentStepCard` — not wired into the app, out of scope.
- `TerminalInput` and prompt submission.
- Keyboard interactions. The rail and dots are decorative (`aria-hidden`).

## Files Affected

- `src/components/InlineAIBlock.tsx` — drop `Sparkles` import; restructure to remove the per-block prompt wrapper styling; add `isFollowup` prop; render `YOU` / `↪ YOU` label.
- `src/components/InlineAIBlock.module.css` — remove `.prompt`, `.promptIcon`; add `.promptLabel`, `.promptLabelFollowup`; add `.conversation`, `.conversationRail`, `.dotUser`, `.dotAi`; adjust per-turn margins.
- `src/components/BlockList.tsx` — add grouping pass that wraps consecutive `'ai'` items in `<AIConversation>`. No change to `DisplayItem` shape.

No other files require changes. No new dependencies.

## Testing

Manual visual verification in dev (`npm run dev`):

1. Single AI question → response.
2. Two consecutive AI questions → one conversation wrapper, two turns, second has `↪ YOU` label.
3. Three-turn conversation with streaming on the third turn → rail extends through all three; last card streams normally.
4. AI question → shell command run → AI question → two separate conversations, each with its own endpoint dots.
5. Long multi-paragraph prompt with code fence inside a conversation → rail extends correctly past the prompt.
6. Conversation containing AI block with expanded tool calls → rail spans full card height.
7. Queued prompts on the active (streaming) turn → render alongside without colliding with the rail.

No automated tests added — this is presentational CSS/markup and a pure grouping function with no logic changes to streaming or data flow.

## Non-Goals

- Redesigning the AI response card internals.
- Per-handoff dots inside a conversation (rejected: simpler with only endpoints).
- Continuous gradient that oscillates green↔purple at every turn (rejected: gradient math gets fiddly with N turns; soft single-gradient reads calmer).
- Right-aligned chat bubbles, unified turn card — declined in favor of the threaded rail.
- Persisting conversation grouping in state or across sessions — grouping is purely a render-time function of `items`.
- Animated/pulsing dots during streaming — can revisit if the static rail feels too inert.
