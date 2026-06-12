# Richer Theming — Design

Date: 2026-06-12
Status: user-approved (all three directions confirmed; lifted-dark Ash; full depth; Cosmos = theatrical with a strong star presence)

## Goal

Add three fully fleshed-out themes alongside the current look, selectable from
Quick Settings and the Settings overlay, persisted like every other setting:

- **Graphite** — a darker, pure-neutral gray (no blue tint).
- **Ash** — a lighter gray: still a dark theme, lifted ambient brightness and contrast.
- **Cosmos** — deep-space indigo with a subtle static starfield + nebula wash.
- **Tai Dark** — the existing palette, unchanged, remains the default.

"High polish" means each theme themes *everything*: UI chrome, accent roles,
terminal ANSI palette (both xterm and the ANSI→HTML renderer), Shiki syntax
highlighting, selection color, and the window-frame shimmer gradient.

## Decisions (defaults chosen)

1. "Lighter gray" = lifted dark theme (not a true light theme).
2. Full depth: ANSI + syntax + selection + shimmer are per-theme.
3. Cosmos atmosphere is theatrical (user choice): two drifting + twinkling
   starfield layers, static nebula, slow aurora sweep, occasional shooting
   star, glow on the stream cursor and card shadows. All animations are
   transform/opacity-only (composited, no per-frame repaints) and disabled
   under `prefers-reduced-motion`. Layers render as `.cosmos-atmosphere`
   children at z-index -1 inside the isolated `.app-root` stacking context.

## Architecture

**CSS variables remain the single theming mechanism for the DOM.** Each theme
is a `[data-theme="<id>"]` block in `globals.css` overriding the `:root`
variable set. New variable families are added:

- `--ansi-30…37`, `--ansi-90…97`, `--ansi-bg-40…47`, `--ansi-bg-100…107` —
  the 16-color terminal palette. `ansiToHtml.ts` emits `var(--ansi-N)`
  instead of hex, so **already-rendered scrollback rethemes live**.
- `--shiki-foreground/background/token-*` — consumed by Shiki's
  `createCssVariablesTheme`, so **already-highlighted code rethemes live**
  with a per-theme syntax palette and zero re-highlighting.
- `--selection-bg`, `--frame-gradient`, `--app-bg` — selection color,
  window shimmer, and root background (Cosmos layers nebula + starfield
  gradients into `--app-bg`).

**xterm.js needs literal colors**, so `src/theme/themes.ts` (new) holds a
registry: per-theme xterm `ITheme` objects (mirroring the CSS ANSI values)
plus a tiny module store (`setActiveTheme` / `subscribeTheme`).
`HiddenXterm` subscribes and live-updates `xterm.options.theme`.

**Settings plumbing** reuses the existing pipeline: `appearance.theme`
default `'default'` in `useSettings.ts`; `App.tsx` sets `data-theme` and
calls `setActiveTheme`; dropdowns in QuickSettings and SettingsOverlay.

## Files

| File | Change |
|---|---|
| `src/styles/globals.css` | `:root` gains ansi/shiki/selection/frame/app-bg vars (current values); three `[data-theme]` blocks; Cosmos background layers; `::selection` and `.window-frame::before` use vars; `.app-root` class owns background |
| `src/theme/themes.ts` (new) | theme ids/labels, xterm palettes, active-theme store |
| `src/utils/ansiToHtml.ts` | 16-color codes emit `var(--ansi-*)`; 256-color basic-16 too |
| `src/utils/shikiHighlighter.ts` | `createCssVariablesTheme` instead of `github-dark` |
| `src/components/HiddenXterm.tsx` | theme from registry; subscribe for live switch |
| `src/hooks/useSettings.ts` | `'appearance.theme': 'default'` |
| `src/App.tsx` | `data-theme` attr, `app-root` class, `setActiveTheme` effect, QuickSettings wiring |
| `src/components/QuickSettings.tsx` | Theme dropdown (top of General) |
| `src/components/SettingsOverlay.tsx` | Theme select in Appearance |
| `tests/unit/themes.test.ts` (new) | registry completeness; ansiToHtml emits vars; settings default |

## Palettes (summary)

All four themes keep the same role semantics (shell=green, ai=violet,
agent=orange, error/warn/info) so block rails stay recognizable; hues are
tuned per theme. Graphite is pure-neutral (#0a0a0c base), Ash is lifted
(#1b1d20 base, brighter text), Cosmos is indigo (#0a0a16 base, teal/violet/
pink accents, starfield via repeating radial-gradient tiles — static).

## Error handling

Unknown/missing `appearance.theme` falls back to `'default'` everywhere
(CSS: no `[data-theme]` match → `:root` values; TS: registry lookup
falls back to the default entry).

## Testing

Unit: registry/ANSI var emission/defaults. Manual: in-app render of theme
previews already validated the direction; full app verification via
`npm run dev` after implementation.
