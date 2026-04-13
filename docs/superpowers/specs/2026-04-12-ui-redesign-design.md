# Tai UI Redesign — Evolved Identity

**Date:** 2026-04-12
**Direction:** Option D — "Keep Tai's existing hacker DNA but crank up the production quality. Sharper surfaces, noise textures, gradient accent lines, better depth hierarchy. Same soul, much better execution."

## Design Decisions

| Decision | Choice |
|----------|--------|
| Aesthetic | D — Evolved Identity |
| Color palette | Shell: `#00a884` (kept), AI: `#8b5cf6` (was `#a85ff1`), Agent: `#ea580c` (was `#d4770c`) |
| UI chrome font | Geist Sans (`'Geist', system-ui, sans-serif`) |
| Terminal font | Fira Code (unchanged) |
| Surface treatment | Full Production — noise texture, animated accents, frosted glass, elevated cards |
| Styling approach | CSS Modules (`.module.css` per component) |
| GradientBorder | Removed — top accent line and input border handle mode signaling |

---

## Section 1: Design Tokens & Global Foundation

Changes to `src/styles/globals.css`:

### New/Updated CSS Variables

```css
:root {
  /* Updated colors */
  --color-ai: #8b5cf6;       /* was #a85ff1 */
  --color-agent: #ea580c;    /* was #d4770c */

  /* New font */
  --font-sans: 'Geist', system-ui, sans-serif;

  /* New surface tokens */
  --bg-card: rgba(255, 255, 255, 0.025);
  --border-card: rgba(255, 255, 255, 0.05);
  --shadow-card: 0 1px 3px rgba(0, 0, 0, 0.2);
}
```

### Noise Texture

Applied as `::after` pseudo-element on `#root`:
- SVG `feTurbulence` filter inlined as data URI
- `opacity: 0.03`, `pointer-events: none`, `z-index` above content but below interactive elements
- Covers entire viewport

### Top Accent Line

- 2px div at the very top of the app (first child in App.tsx)
- Static gradient: `linear-gradient(90deg, transparent, #00a884, #8b5cf6, #ea580c, transparent)`
- Shimmer animation: `background-size: 200% 100%`, sliding left-to-right over 8s
- Does NOT change with context mode — it's a brand element

### Selection Color

Update `::selection` background from old purple to `rgba(139, 92, 246, 0.3)` (new `#8b5cf6`).

---

## Section 2: Typography System

### Font Loading

Geist Sans installed via npm (`npm install geist`), imported in `globals.css`:
```css
@import 'geist/dist/fonts/geist-sans/style.css';
```

### Application Rules

| Context | Font |
|---------|------|
| Default (`html, body, #root`) | `var(--font-sans)` |
| TabBar labels, indices | `var(--font-sans)` |
| TrustBadge label | `var(--font-sans)` |
| Buttons (all components) | `var(--font-sans)` |
| Modal text (Settings, Confirm, WhatsNew) | `var(--font-sans)` |
| Duration/time labels | `var(--font-sans)` |
| "Show more" links | `var(--font-sans)` |
| Keyboard hint badges | `var(--font-sans)` |
| Notification toast text | `var(--font-sans)` |
| TerminalInput prompt/command | `var(--font-mono)` |
| CommandBlock prompt/output | `var(--font-mono)` |
| HiddenXterm | `var(--font-mono)` (xterm own rendering) |
| Ghost text / tab completion | `var(--font-mono)` |
| Code blocks in InlineAIBlock | `var(--font-mono)` |

Font sizes remain unchanged — only family swaps.

---

## Section 3: CSS Modules Migration

Every component with inline styles or `<style>` tags gets a paired `.module.css` file:

| Component | Module File |
|-----------|-------------|
| `TabBar.tsx` | `TabBar.module.css` |
| `CommandBlock.tsx` | `CommandBlock.module.css` |
| `TerminalInput.tsx` | `TerminalInput.module.css` |
| `InlineAIBlock.tsx` | `InlineAIBlock.module.css` |
| `BlockList.tsx` | `BlockList.module.css` |
| `ApprovalPrompt.tsx` | `ApprovalPrompt.module.css` |
| `AgentStepCard.tsx` | `AgentStepCard.module.css` |
| `SettingsOverlay.tsx` | `SettingsOverlay.module.css` |
| `ConfirmModal.tsx` | `ConfirmModal.module.css` |
| `UpdateNotifier.tsx` | `UpdateNotifier.module.css` |
| `WhatsNewModal.tsx` | `WhatsNewModal.module.css` |
| `ErrorAffordance.tsx` | `ErrorAffordance.module.css` |
| `TrustBadge.tsx` | `TrustBadge.module.css` |

### Rules

- **Static styles** → CSS module
- **Dynamic styles** (mode-dependent colors, active states, conditional visibility) → inline `style={}` props
- CSS variables used for all theme values — no hardcoded colors in modules
- Component-specific keyframe animations move to their respective module
- Shared animations (fadeIn, spin) stay in `globals.css`

---

## Section 4: Component Visual Changes

### TabBar

- **Background**: Frosted glass — `linear-gradient(180deg, rgba(19,23,32,0.95), rgba(17,20,24,0.9))` with `backdrop-filter: blur(8px)`
- **Height**: 44px (from 40px)
- **Active tab**: Bottom 2px border in mode color, gradient background fill `rgba(mode-color, 0.08) → rgba(mode-color, 0.03)`, radial glow beneath
- **Active label**: `font-weight: 600`, brighter text `#e8ecf0`
- **Inactive labels**: `color: #6a7080`
- **Status dot**: Gets `box-shadow` glow matching mode color
- **Separator**: 1px vertical divider between `+` button and window controls
- **Font**: All labels in `var(--font-sans)`

### CommandBlock

- **Card treatment**: `--bg-card` background, `--border-card` border, `border-radius: 10px`, `--shadow-card`, inset top highlight `inset 0 1px 0 rgba(255,255,255,0.03)`
- **Padding**: `14px 16px` (from `4px 0` + `8px` left)
- **Left accent**: Gradient from solid mode color to transparent (vertical)
- **Duration badge**: Pill style — `rgba(255,255,255,0.04)` background, `border-radius: 10px`, `1px solid rgba(255,255,255,0.06)`
- **Separator**: `linear-gradient(90deg, rgba(mode-color, 0.12), transparent 60%)` between prompt and output
- **Collapsed blocks**: Stay minimal — no card, dimmed at `opacity: 0.3`

### TerminalInput

- **Border radius**: 10px (from 5px)
- **Background**: `linear-gradient(180deg, #181c22, #161a1f)`
- **Shadow**: `0 4px 12px rgba(0,0,0,0.3)`, inset top highlight `inset 0 1px 0 rgba(255,255,255,0.04)`
- **Gradient border**: Mask radius matches at 11.5px, opacity bump to 0.6
- **Hint badges**: `backdrop-filter: blur(4px)`, semi-transparent background

### InlineAIBlock

- Card treatment matching CommandBlock (same `--bg-card`, `--border-card`, `--shadow-card`)
- Left accent in `--color-ai` with gradient fade
- Code blocks inside get slightly elevated sub-surface (`rgba(255,255,255,0.015)` background)

### AgentStepCard

- Card treatment, left accent in `--color-agent`
- Status icons get subtle `box-shadow` glow matching their state color

### ApprovalPrompt

- Card treatment, left accent in `--color-agent`
- Buttons in Geist Sans

### SettingsOverlay

- Modal surface uses `--bg-card` with `--border-card`
- Noise texture on overlay background
- All text in Geist Sans

### ConfirmModal

- Surface uses `--bg-card` with `--border-card`
- Noise texture on overlay background
- Buttons get slight elevation/shadow
- All text in Geist Sans

### WhatsNewModal

- Surface uses `--bg-card` with `--border-card`
- Noise texture on overlay background
- All text in Geist Sans (except code snippets)

### UpdateNotifier

- Surface uses `--bg-card` with `--border-card`
- Noise texture on toast background
- All text in Geist Sans

### ErrorAffordance

- Updated to use `--color-ai` (`#8b5cf6`) for the purple tint

---

## Section 5: App Shell Changes

### App.tsx

- **Remove** `GradientBorder` import and wrapper
- **Add** top accent line as first child: 2px div with animated gradient
- Accent line is static brand element — does not respond to context mode

### Files Deleted

- `src/components/GradientBorder.tsx`

### Files Unchanged (no visual changes)

- `src/components/HiddenXterm.tsx` — uses xterm's own rendering
- `src/hooks/*`
- `src/utils/*`
- `electron/*`

---

## Summary of Visual Identity

The redesign preserves Tai's terminal-first hacker identity while elevating production quality:

- **Three-color system** (green/violet/burnt orange) with cleaner separation
- **Dual typography** creates visual hierarchy — Geist Sans for chrome, Fira Code for terminal
- **Card-based depth** for command blocks and AI responses creates scannable structure
- **Noise texture + gradient accents** add tactile quality without visual noise
- **Frosted glass tab bar** adds depth without heaviness
- **Removed full-app gradient border** in favor of targeted mode signals (input border, tab indicator, accent line)
