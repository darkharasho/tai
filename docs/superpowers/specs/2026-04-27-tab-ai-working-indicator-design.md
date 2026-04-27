# Tab AI-Working Indicator — Design

## Problem

When a long AI conversation accumulates many tool calls, the assistant block's header (which carries the existing streaming dot, elapsed time, and Stop button) scrolls out of view. The user loses any persistent signal that the AI is still working. The signal also doesn't survive switching to another tab — there's no way to glance at tabs and know "claude is still going on tab 1".

## Goal

Surface a single, always-visible "AI is working" signal at the tab level. Cross-tab visibility is the primary need: a user who switched away from the active tab should be able to glance at the tab strip and see which tabs are still generating.

## Non-Goals

- In-scroll affordances (sticky header, jump-to-current pill).
- Status strip above the input area.
- Awaiting-approval state, completion flashes, error colors, window-title indicators.
- Any change to the existing in-block streaming dot, Stop button, or duration.

## Design

### Behavior

- Each tab carries an `aiWorking: boolean` flag.
- The flag is `true` from the moment the user submits an AI request until the provider signals `done`, `error`, or `cancel`/`abort`.
- The flag is per-tab; multiple tabs can be `true` concurrently.
- When `true`, the tab renders a small pulsing dot before its label. When `false`, no dot.

### Visual

- 7px circle, color `--color-agent` (matches existing AI-mode accent), with a soft glow (`box-shadow: 0 0 6px <color>`).
- Pulse animation: `1.4s ease-in-out infinite`, alternating opacity 1↔0.4 and scale 1↔0.8.
- Rendered immediately to the left of the tab label with a 6px gap. The dot is conditionally rendered (no reserved slot) — the small horizontal nudge when it appears is acceptable since tabs are short and the transition is infrequent.

### State Wiring

- Add `aiWorking?: boolean` to `TabState` in `src/types.ts`.
- Flip to `true` when an AI request is initiated for the tab (the same site that today calls `provider.send(...)`).
- Flip to `false` on any provider terminal signal: response complete, provider error, user cancel/stop.
- `TabBar` reads `tab.aiWorking` and renders the dot.

### Provider Coverage

Must work uniformly across all three current providers (`claude`, `codex`, `gemini`). The flip points are wherever the existing per-provider lifecycle already fires — the same hooks that drive the in-block streaming dot today are the source of truth.

## Affected Files (rough)

- `src/types.ts` — extend `TabState`.
- `src/components/TabBar.tsx` and its CSS module — conditional dot before label.
- `src/components/TerminalSession.tsx` (or wherever `provider.send` is dispatched and lifecycle events are received) — set/clear the flag.

Exact wiring will be finalized in the implementation plan after reading the current provider lifecycle code.

## Risks / Open Questions

- **Provider lifecycle parity:** If one provider doesn't currently emit a clean "done" signal in all error paths, the dot could get stuck. The implementation plan must verify each provider's terminal-event coverage and add a safety reset on `error`/`cancel` if needed.
- **Layout nudge:** Rendering the dot conditionally shifts the label by ~13px. If this feels jumpy in practice, fall back to always reserving the slot (render an invisible placeholder when idle). Decision deferred to implementation.

## Out of Scope (explicitly)

- Awaiting-approval / pending-permission state.
- Completion or error flash.
- Status strip above input (option B2).
- Sticky in-scroll header (option A1).
- Window title indicator (option B3).
