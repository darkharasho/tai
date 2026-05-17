# AI Prompt + Response Thread Redesign

**Date:** 2026-05-16
**Component:** `src/components/InlineAIBlock.tsx`
**Status:** Approved design — ready for implementation plan

## Problem

The user's prompt currently renders as a floating line of text with only a small sparkle icon above the AI response card. There is no clear visual signal that the prompt and the card below belong to the same exchange — the prompt reads like a stray comment rather than a turn in a conversation.

## Goal

Make each AI exchange read unambiguously as one conversational turn: a user prompt followed by an AI reply, visually stitched together — while keeping the AI response card as the primary artifact.

## Design: H4 — Threaded Rail with Bolder Gradient

A vertical 3px rail runs from the user prompt down through the AI response card. The rail uses a smooth top-to-bottom gradient from the shell color (`#00a884`, green) into the AI color (`#8b5cf6`, purple), encoding the "you → AI" flow as color. Small flush dots anchor each end of the rail.

### Layout

```
┌─ 22px left padding ─┐
│ ●  YOU              │   ← shell-green dot, "You" label
│ ┃  how does the segmenter handle backpressure?
│ ┃
│ ┃  ┌──────────────────────────────────────┐
│ ┃  │ ✦ Claude · 2.4s                      │
│ ┃  │ The segmenter pauses node-pty when… │
│ ●  └──────────────────────────────────────┘   ← AI-purple dot at bottom
```

- **Rail:** 3px wide, absolutely positioned at `left: 7px`, spans from `top: 6px` to `bottom: 6px` of the wrapper. `linear-gradient(to bottom, rgba(0,168,132,0.85) 0%, rgba(0,168,132,0.45) 22%, rgba(139,92,246,0.45) 78%, rgba(139,92,246,0.85) 100%)`. `border-radius: 2px`.
- **Dots:** 8×8px circles at `left: 5px`, with a 2px border using `var(--bg-surface)` so they appear "punched through" the rail. Green dot at top (`top: 4px`), purple dot at bottom (`bottom: 4px`). No glow.
- **Prompt label:** "You" rendered as a 10px uppercase letter-spaced block, color `var(--color-shell)`, 500 weight, 2px bottom margin.
- **Prompt text:** Existing markdown rendering preserved (ReactMarkdown w/ remark-gfm + remark-breaks), font and size unchanged from current `.promptText`.
- **AI card:** No structural changes — same accent strip, header, body, footer as today.

### Wrapper structure

Replace the current `.wrapper > [.prompt, .block]` structure with:

```jsx
<div className={styles.wrapper}>
  <div className={styles.rail} />
  <span className={styles.dotUser} />
  <span className={styles.dotAi} />
  <div className={styles.prompt}>
    <span className={styles.promptLabel}>You</span>
    <ReactMarkdown …>{question}</ReactMarkdown>
  </div>
  {/* existing .block card unchanged */}
</div>
```

`.wrapper` becomes `position: relative; padding-left: 22px;` and the old `.promptIcon` (Sparkles) is removed.

### Edge cases

- **No question (rare):** If `question` is empty, skip the prompt block, the "You" label, and the **top** dot. The rail begins at the top of the AI card and uses only the purple portion of the gradient (top-anchored at `rgba(139,92,246,0.6)` → bottom `rgba(139,92,246,0.85)`).
- **No AI response yet (prompt queued/streaming about to start):** Render prompt + label + top dot + rail. Rail extends down to where the card will appear; the bottom purple dot is omitted until the card renders.
- **Queued prompts (`queuedPrompts` array):** Unchanged — they continue to render as `QueuedChip`s in their current location relative to the block. Not part of the threaded rail.
- **Long / multi-line prompts:** Rail naturally extends; no special handling needed since it's positioned relative to the wrapper.
- **Markdown code blocks in prompt:** Existing `.promptText pre` and `.promptText code` styles preserved; rail sits to the left of them as normal.

### What does NOT change

- The AI card itself (`.block`, `.accent`, `.header`, `.body`, footer) — colors, content, tool call rendering, copy buttons, stop button, duration display.
- `BlockSegmenter`, `BlockList`, the AI entry data model, streaming behavior.
- `AgentStepCard` — out of scope (not wired into the app currently).
- Keyboard interactions, accessibility tree (rail/dots are decorative, `aria-hidden` recommended).

## Files Affected

- `src/components/InlineAIBlock.tsx` — replace prompt block markup, drop `Sparkles` import.
- `src/components/InlineAIBlock.module.css` — remove `.prompt`, `.promptIcon`; rename `.promptText` → `.promptBody`; add `.rail`, `.dotUser`, `.dotAi`, `.promptLabel`; update `.wrapper` to `position: relative; padding-left: 22px`.

No other files require changes. No new dependencies.

## Testing

Manual visual verification in dev (`npm run dev`):

1. Single-turn AI question → response (golden path).
2. Streaming response: rail visible from the moment prompt is submitted, bottom dot appears when card mounts.
3. Long multi-paragraph prompt with code fence → rail extends correctly.
4. AI block with tool calls expanded → rail covers full card height.
5. Multiple AI blocks stacked → each has its own independent rail.
6. Queued prompts shown alongside → no visual collision with rail/dots.

No automated tests added — this is presentational CSS/markup with no logic changes.

## Non-Goals

- Redesigning the AI response card internals.
- Changing the user prompt's input/submission UI (`TerminalInput`).
- Animated/pulsing dots during streaming (considered as H3 variant, declined for now — can revisit if the static rail feels too inert).
- Right-aligned chat bubbles (Option A) or unified turn card (Option C) — explicitly chosen against in favor of keeping the AI card as the visual hero.
