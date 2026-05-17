# Card Accent Styles — Design

## Problem

Cards across the app (AgentStepCard, InlineAIBlock, CommandBlock, ApprovalPrompt) currently use an L-shaped corner-bracket accent: masked top-left and bottom-right borders in the role color (agent/orange, AI/purple, shell/green). We want to replace this with a more typical card-accent treatment, and let users choose between several options as an appearance preference.

## Goals

- Replace the corner-bracket style with five conventional accent styles, user-selectable.
- Keep the existing per-role accent colors (`--color-agent`, `--color-ai`, `--color-shell`).
- Apply uniformly across all four card components by driving everything from CSS variables on the root.
- Mirror the existing `appearance.colorMode` setting pattern — no new architecture.

## Non-Goals

- Preserving the bracket style. It is dropped entirely.
- Adding accent styles beyond the five chosen during brainstorming.
- Changing card geometry, padding, or color palette outside the accent treatment.

## Accent Styles

Five styles, selectable via a new `appearance.cardAccent` setting:

| Key | Label | Treatment |
|---|---|---|
| `stripe-left` *(default)* | Left Stripe | 3px solid left border in accent color; rest of border stays `--border-card`. |
| `stripe-top` | Top Stripe | 2px solid top border in accent color. |
| `tinted` | Tinted Border | Full border tinted to ~50% opacity of accent color; soft outer halo via `box-shadow`. |
| `header-tint` | Header Tint | Top ~32px gradient wash in accent color fading down, plus a 1px hairline below. |
| `stripe-glow` | Stripe + Glow | `stripe-left` plus a soft outer glow on the left side. |

## Architecture

### Config setting

Add `appearance.cardAccent: string` to the existing config schema, alongside `appearance.colorMode`. Default value: `stripe-left`.

### Root attribute

`src/App.tsx` reads the setting (parallel to `colorMode` at `src/App.tsx:164`) and sets `data-card-accent={cardAccent}` on the root `<div>` (parallel to `data-color-mode` at `src/App.tsx:167`).

### CSS variable system

The current accent system in `src/styles/globals.css:32-39` exposes:

```css
--accent-tl-mask, --accent-tl-composite, --accent-tl-webkit-composite,
--accent-br-mask, --accent-br-composite, --accent-br-webkit-composite,
--accent-br-opacity
```

These are designed around two-border masking, which doesn't generalize. Replace them with a style-agnostic set:

```css
/* Borders applied to .card itself */
--accent-card-border-color: var(--border-card);
--accent-card-border-left: 1px solid var(--accent-card-border-color);
--accent-card-border-top: 1px solid var(--accent-card-border-color);
--accent-card-border-right: 1px solid var(--accent-card-border-color);
--accent-card-border-bottom: 1px solid var(--accent-card-border-color);
--accent-card-shadow: var(--shadow-card);

/* ::before overlay (used for header tint or stripe-top accents that need to sit above body bg) */
--accent-before-display: none;
--accent-before-background: none;
--accent-before-border-bottom: none;
--accent-before-height: 0;

/* ::after overlay (reserved for future outer glow / hover states) */
--accent-after-display: none;
```

Then each style overrides only what it needs:

```css
[data-card-accent="stripe-left"] {
  --accent-card-border-left: 3px solid var(--accent-color);
}

[data-card-accent="stripe-top"] {
  --accent-card-border-top: 2px solid var(--accent-color);
}

[data-card-accent="tinted"] {
  --accent-card-border-color: color-mix(in srgb, var(--accent-color) 50%, transparent);
  --accent-card-shadow:
    0 0 0 1px color-mix(in srgb, var(--accent-color) 15%, transparent),
    0 4px 16px color-mix(in srgb, var(--accent-color) 8%, transparent);
}

[data-card-accent="header-tint"] {
  --accent-before-display: block;
  --accent-before-height: 32px;
  --accent-before-background:
    linear-gradient(180deg,
      color-mix(in srgb, var(--accent-color) 10%, transparent),
      transparent);
  --accent-before-border-bottom:
    1px solid color-mix(in srgb, var(--accent-color) 25%, transparent);
}

[data-card-accent="stripe-glow"] {
  --accent-card-border-left: 3px solid var(--accent-color);
  --accent-card-shadow:
    -8px 0 24px -12px color-mix(in srgb, var(--accent-color) 35%, transparent),
    var(--shadow-card);
}
```

### Card module changes

Each of the four card modules has roughly this structure today (e.g. `AgentStepCard.module.css:1-43`):

```css
.card {
  --accent-color: var(--color-agent);
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  box-shadow: var(--shadow-card);
  /* ... */
}
.card::before { /* TL masked border */ }
.card::after  { /* BR masked border */ }
```

Replace with:

```css
.card {
  --accent-color: var(--color-agent);
  position: relative;
  background: var(--bg-card);
  border-top: var(--accent-card-border-top);
  border-right: var(--accent-card-border-right);
  border-bottom: var(--accent-card-border-bottom);
  border-left: var(--accent-card-border-left);
  border-radius: 10px;
  box-shadow: var(--accent-card-shadow);
  /* ... */
}
.card::before {
  content: '';
  display: var(--accent-before-display);
  position: absolute;
  top: 0; left: 0; right: 0;
  height: var(--accent-before-height);
  background: var(--accent-before-background);
  border-bottom: var(--accent-before-border-bottom);
  border-top-left-radius: 10px;
  border-top-right-radius: 10px;
  pointer-events: none;
  z-index: 1;
}
.card::after {
  display: var(--accent-after-display);
}
```

The `::after` rule is kept but inert by default — leaves a hook for future hover/active treatments without another refactor. Header content already uses `z-index: 2` (e.g. `AgentStepCard.module.css:58`) so it stays above the `::before` overlay.

The four affected modules:
- `src/components/AgentStepCard.module.css` (accent: `--color-agent`)
- `src/components/InlineAIBlock.module.css` (accent: `--color-ai`)
- `src/components/CommandBlock.module.css` (does not set `--accent-color` locally — inherits from its parent card, e.g. AgentStepCard or InlineAIBlock; this stays the same)
- `src/components/ApprovalPrompt.module.css` (accent: `--color-agent`)

### Interaction with `data-color-mode="low"`

The existing low-color mode (`src/styles/globals.css:44-48`) currently dampens accents by hiding the BR mask and fading the TL. Under the new system, low mode should reduce accent prominence universally:

```css
[data-color-mode="low"] {
  --accent-color: var(--text-muted);  /* drops role color for muted gray */
  --shimmer-duration: 30s;
}
```

This applies uniformly regardless of selected `cardAccent` style.

### QuickSettings dropdown

Add a Card Accent dropdown in `src/components/QuickSettings.tsx` under the Appearance category, modeled on the Color Mode dropdown at `src/components/QuickSettings.tsx:188-194`:

```tsx
<div className={styles.settingRow}>
  <span className={styles.settingLabel}>Card Accent</span>
  <CustomDropdown
    value={cardAccent}
    options={CARD_ACCENT_OPTIONS}
    onChange={onCardAccentChange}
  />
</div>
```

`CARD_ACCENT_OPTIONS` defined alongside `COLOR_MODE_OPTIONS`:

```ts
const CARD_ACCENT_OPTIONS = [
  { value: 'stripe-left', label: 'Left Stripe' },
  { value: 'stripe-top', label: 'Top Stripe' },
  { value: 'tinted', label: 'Tinted Border' },
  { value: 'header-tint', label: 'Header Tint' },
  { value: 'stripe-glow', label: 'Stripe + Glow' },
];
```

Props threaded through from `App.tsx` exactly like `colorMode` / `onColorModeChange`.

## Data Flow

```
config['appearance.cardAccent']
  └─ App.tsx reads it
       └─ <div data-card-accent={value}>
            └─ globals.css [data-card-accent="..."] block overrides --accent-* vars
                 └─ .card rules in 4 modules consume vars → render style
       └─ <QuickSettings cardAccent onCardAccentChange />
            └─ CustomDropdown writes setSetting('appearance.cardAccent', ...)
```

## Migration

Users with no `appearance.cardAccent` set fall back to the default `stripe-left`. No migration script needed — the setting key is new, so the default kicks in naturally.

The old `--accent-tl-mask` family of variables is removed in the same change. No other code references them outside the four card modules and globals.css.

## Testing

Manual verification across the four card surfaces:
- Agent step card (orange accent)
- Inline AI block (purple accent)
- Command block (shell accent)
- Approval prompt (agent accent)

For each of the five accent styles, plus `data-color-mode="low"` overlay, confirm:
- Border / overlay renders correctly
- Header content remains legible (z-index intact)
- No layout shift between styles (geometry only affects border + box-shadow + ::before overlay)

## Open Questions

None — defaults and dropped-bracket decision both resolved during brainstorming.
