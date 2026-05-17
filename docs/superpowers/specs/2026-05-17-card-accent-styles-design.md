# Card Accent Styles — Design

## Problem

Cards across the app (AgentStepCard, InlineAIBlock, CommandBlock, ApprovalPrompt) currently use an L-shaped corner-bracket accent: masked top-left and bottom-right borders in the role color (agent/orange, AI/purple, shell/green). We want to add several more conventional card-accent treatments as user-selectable alternatives, while keeping the current bracket style as the default.

## Goals

- Add five new conventional accent styles alongside the existing bracket style.
- Make the accent style a user appearance preference, defaulting to the current bracket look.
- Keep the existing per-role accent colors (`--color-agent`, `--color-ai`, `--color-shell`).
- Apply uniformly across all four card components by driving everything from CSS variables on the root.
- Mirror the existing `appearance.colorMode` setting pattern — no new architecture.

## Non-Goals

- Removing or modifying the existing bracket style. It remains the default.
- Adding accent styles beyond the six total (brackets + five new).
- Changing card geometry, padding, or color palette outside the accent treatment.

## Accent Styles

Six styles, selectable via a new `appearance.cardAccent` setting:

| Key | Label | Treatment |
|---|---|---|
| `brackets` *(default)* | Corner Brackets | Current style. Masked top-left and bottom-right L-shaped borders in accent color. |
| `stripe-left` | Left Stripe | 3px solid left border in accent color; rest of border stays `--border-card`. |
| `stripe-top` | Top Stripe | 2px solid top border in accent color. |
| `tinted` | Tinted Border | Full border tinted to ~50% opacity of accent color; soft outer halo via `box-shadow`. |
| `header-tint` | Header Tint | Top ~32px gradient wash in accent color fading down, plus a 1px hairline below. |
| `stripe-glow` | Stripe + Glow | `stripe-left` plus a soft outer glow on the left side. |

## Architecture

### Config setting

Add `appearance.cardAccent: string` to the existing config schema, alongside `appearance.colorMode`. Default value: `brackets`.

### Root attribute

`src/App.tsx` reads the setting (parallel to `colorMode` at `src/App.tsx:164`) and sets `data-card-accent={cardAccent}` on the root `<div>` (parallel to `data-color-mode` at `src/App.tsx:167`).

### CSS variable system

The current accent system in `src/styles/globals.css:32-39` exposes:

```css
--accent-tl-mask, --accent-tl-composite, --accent-tl-webkit-composite,
--accent-br-mask, --accent-br-composite, --accent-br-webkit-composite,
--accent-br-opacity
```

These are kept as-is for the `brackets` style. To support the new styles without forcing each module to handle every variant inline, add a second layer of accent vars that all six styles populate uniformly. The `.card` rule and its `::before`/`::after` then read both sets — the existing bracket vars (for `brackets`) and the new vars (for the others).

Approach: introduce a `--accent-mode` family of overrides keyed on `[data-card-accent="<value>"]`. The default `:root` (or `[data-card-accent="brackets"]`) keeps the current bracket vars active and leaves the new-style vars inert. Each non-bracket value disables the bracket masks (by setting their mask-image to `none` so the existing `::before`/`::after` rules render nothing) and populates the new-style vars.

New vars added to `:root`:

```css
/* Card-level border + shadow overrides (default: inert, falls back to existing values) */
--accent-card-border-left: 1px solid var(--border-card);
--accent-card-border-top: 1px solid var(--border-card);
--accent-card-border-right: 1px solid var(--border-card);
--accent-card-border-bottom: 1px solid var(--border-card);
--accent-card-shadow: var(--shadow-card);

/* Overlay for header-tint (default: hidden) */
--accent-overlay-display: none;
--accent-overlay-background: none;
--accent-overlay-border-bottom: none;
--accent-overlay-height: 0;
```

Per-style blocks:

```css
/* Default — explicit so brackets stays selectable even after the user
   has set a value, and so removing the attribute also yields brackets. */
:root,
[data-card-accent="brackets"] {
  /* existing bracket mask vars at lines 33-39 remain in effect */
}

[data-card-accent="stripe-left"] {
  --accent-tl-mask: none;
  --accent-br-mask: none;
  --accent-card-border-left: 3px solid var(--accent-color);
}

[data-card-accent="stripe-top"] {
  --accent-tl-mask: none;
  --accent-br-mask: none;
  --accent-card-border-top: 2px solid var(--accent-color);
}

[data-card-accent="tinted"] {
  --accent-tl-mask: none;
  --accent-br-mask: none;
  --accent-card-border-left: 1px solid color-mix(in srgb, var(--accent-color) 50%, transparent);
  --accent-card-border-top: 1px solid color-mix(in srgb, var(--accent-color) 50%, transparent);
  --accent-card-border-right: 1px solid color-mix(in srgb, var(--accent-color) 50%, transparent);
  --accent-card-border-bottom: 1px solid color-mix(in srgb, var(--accent-color) 50%, transparent);
  --accent-card-shadow:
    0 0 0 1px color-mix(in srgb, var(--accent-color) 15%, transparent),
    0 4px 16px color-mix(in srgb, var(--accent-color) 8%, transparent);
}

[data-card-accent="header-tint"] {
  --accent-tl-mask: none;
  --accent-br-mask: none;
  --accent-overlay-display: block;
  --accent-overlay-height: 32px;
  --accent-overlay-background:
    linear-gradient(180deg,
      color-mix(in srgb, var(--accent-color) 10%, transparent),
      transparent);
  --accent-overlay-border-bottom:
    1px solid color-mix(in srgb, var(--accent-color) 25%, transparent);
}

[data-card-accent="stripe-glow"] {
  --accent-tl-mask: none;
  --accent-br-mask: none;
  --accent-card-border-left: 3px solid var(--accent-color);
  --accent-card-shadow:
    -8px 0 24px -12px color-mix(in srgb, var(--accent-color) 35%, transparent),
    var(--shadow-card);
}
```

Setting `--accent-tl-mask: none` causes the masked `::before`/`::after` overlays in the existing card modules to render nothing (the `mask-image: none` renders the whole element, but together with the simultaneously-removed border colors below it produces no visible mark — see card module changes).

### Card module changes

Each of the four card modules currently looks roughly like (e.g. `AgentStepCard.module.css:1-43`):

```css
.card {
  --accent-color: var(--color-agent);
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  box-shadow: var(--shadow-card);
  /* ... */
}
.card::before {
  /* TL masked border in --accent-color */
  border-left: 2px solid var(--accent-color);
  border-top: 2px solid var(--accent-color);
  -webkit-mask-image: var(--accent-tl-mask);
  mask-image: var(--accent-tl-mask);
  /* ... */
}
.card::after { /* BR equivalent */ }
```

Update to:

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

/* Bracket overlays — TL (unchanged behavior; --accent-tl-mask: none in other
   styles hides them by allowing the new --accent-card-border-* values to
   take effect without the masked overlay sitting on top of them) */
.card::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 10px;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
  border-left: 2px solid var(--accent-color);
  border-top: 2px solid var(--accent-color);
  pointer-events: none;
  z-index: 1;
  -webkit-mask-image: var(--accent-tl-mask, none);
  mask-image: var(--accent-tl-mask, none);
  -webkit-mask-composite: var(--accent-tl-webkit-composite);
  mask-composite: var(--accent-tl-composite);
}

.card::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 10px;
  border-right: 2px solid var(--accent-color);
  border-bottom: 2px solid var(--accent-color);
  pointer-events: none;
  z-index: 1;
  opacity: var(--accent-br-opacity);
  -webkit-mask-image: var(--accent-br-mask, none);
  mask-image: var(--accent-br-mask, none);
  -webkit-mask-composite: var(--accent-br-webkit-composite);
  mask-composite: var(--accent-br-composite);
}
```

Important: when `--accent-tl-mask: none`, the `::before` overlay would normally render the entire 2px border around the card (no mask = no clipping), visually conflicting with the new style. To prevent this, also set `--accent-tl-webkit-composite` / `--accent-tl-composite` such that the unmasked render produces nothing, OR equivalently, swap to using `--accent-tl-mask: linear-gradient(transparent, transparent)` (a fully-transparent mask) for non-bracket styles. The spec uses the transparent-mask approach to keep the rule shape stable:

```css
[data-card-accent="stripe-left"] {
  --accent-tl-mask: linear-gradient(transparent, transparent);
  --accent-br-mask: linear-gradient(transparent, transparent);
  /* ... */
}
```

This is applied uniformly to all non-`brackets` style blocks. The `::before` and `::after` overlays then render nothing in those modes.

A new overlay element is added for the `header-tint` style. Since `::before` and `::after` are already used by brackets, this gets its own selector — a wrapper or a third pseudo isn't available, so the cleanest path is reusing `::before` only when bracket masks are off. Rather than juggling pseudo-elements conditionally, the spec uses a simpler approach: the `header-tint` style sets `--accent-card-border-top` to an invisible (1px transparent) border and instead uses an inset `box-shadow` to paint the gradient + hairline.

Updated header-tint block:

```css
[data-card-accent="header-tint"] {
  --accent-tl-mask: linear-gradient(transparent, transparent);
  --accent-br-mask: linear-gradient(transparent, transparent);
  --accent-card-shadow:
    inset 0 32px 0 -16px color-mix(in srgb, var(--accent-color) 10%, transparent),
    inset 0 32px 0 -31px color-mix(in srgb, var(--accent-color) 25%, transparent),
    var(--shadow-card);
}
```

This removes the need for `--accent-overlay-*` vars and the additional `::before` overlay element. Card modules then only consume the simpler set: `--accent-card-border-{top,right,bottom,left}`, `--accent-card-shadow`, and the existing bracket mask vars.

The four affected modules:
- `src/components/AgentStepCard.module.css` (accent: `--color-agent`)
- `src/components/InlineAIBlock.module.css` (accent: `--color-ai`)
- `src/components/CommandBlock.module.css` (does not set `--accent-color` locally — inherits from its parent card, e.g. AgentStepCard or InlineAIBlock; this stays the same)
- `src/components/ApprovalPrompt.module.css` (accent: `--color-agent`)

### Interaction with `data-color-mode="low"`

The existing low-color mode (`src/styles/globals.css:44-48`) dampens accents by fading the TL mask and hiding the BR mask. It is bracket-specific. With multiple accent styles, low-color mode should apply uniformly: drop the role color to `--text-muted` so the accent reads as a neutral gray, regardless of style.

```css
[data-color-mode="low"] {
  --accent-color: var(--text-muted);
  --shimmer-duration: 30s;
}
```

The existing bracket-specific overrides in the `[data-color-mode="low"]` block (the modified `--accent-tl-mask` and `--accent-br-opacity: 0`) are kept so that the bracket style continues to look exactly as it does today when low-color is on. Other styles inherit only the `--accent-color` swap.

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
  { value: 'brackets', label: 'Corner Brackets' },
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
config['appearance.cardAccent']  (default: 'brackets')
  └─ App.tsx reads it
       └─ <div data-card-accent={value}>
            └─ globals.css [data-card-accent="..."] block overrides --accent-* vars
                 └─ .card rules in 4 modules consume vars → render style
       └─ <QuickSettings cardAccent onCardAccentChange />
            └─ CustomDropdown writes setSetting('appearance.cardAccent', ...)
```

## Migration

Users with no `appearance.cardAccent` set fall back to the default `brackets`, which produces the current look. No migration script needed.

The existing `--accent-tl-mask` / `--accent-br-mask` variable family is preserved — the bracket style depends on it.

## Testing

Manual verification across the four card surfaces:
- Agent step card (orange accent)
- Inline AI block (purple accent)
- Command block (shell accent)
- Approval prompt (agent accent)

For each of the six accent styles, plus `data-color-mode="low"` overlay, confirm:
- Border / overlay renders correctly
- Header content remains legible
- No layout shift between styles (geometry only affects border + box-shadow)
- `brackets` style matches the pre-change appearance pixel-for-pixel

## Open Questions

None — `brackets` stays as default, all five new styles added with no removals.
