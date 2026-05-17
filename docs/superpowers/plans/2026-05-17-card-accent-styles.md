# Card Accent Styles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add five new conventional card-accent styles (left stripe, top stripe, tinted border, header tint, stripe + glow) as user-selectable alternatives to the current corner-bracket style, defaulting to brackets.

**Architecture:** New `appearance.cardAccent` config setting (default `brackets`) is applied as a `data-card-accent` attribute on the root `<div>` in `App.tsx`, parallel to the existing `data-color-mode`. `src/styles/globals.css` adds per-style blocks that override accent CSS variables. The four card modules (AgentStepCard, InlineAIBlock, CommandBlock, ApprovalPrompt) are refactored to read border and box-shadow from new vars (`--accent-card-border-{top,right,bottom,left}`, `--accent-card-shadow`) while the existing `--accent-tl-mask` / `--accent-br-mask` system stays in place for brackets. Non-bracket styles disable the bracket overlays by overriding the masks to a fully-transparent gradient. A new dropdown in `QuickSettings.tsx` exposes the setting.

**Tech Stack:** React 18, TypeScript, CSS Modules, Electron. No tests are added for the visual change itself — verification is manual against the running app.

**Spec:** `docs/superpowers/specs/2026-05-17-card-accent-styles-design.md`

---

## File Structure

**Modified:**
- `src/hooks/useSettings.ts` — add default for `appearance.cardAccent`
- `src/styles/globals.css` — add new accent vars to `:root`, add `[data-card-accent="..."]` blocks for each style, update low-color-mode block
- `src/App.tsx` — read `appearance.cardAccent`, apply as `data-card-accent`, thread props through to QuickSettings
- `src/components/QuickSettings.tsx` — add `cardAccent` / `onCardAccentChange` props, add `CARD_ACCENT_OPTIONS` list, add dropdown row
- `src/components/AgentStepCard.module.css` — switch `.card` border + box-shadow to new vars
- `src/components/InlineAIBlock.module.css` — switch `.block` border + box-shadow to new vars
- `src/components/CommandBlock.module.css` — switch `.block` border + box-shadow to new vars
- `src/components/ApprovalPrompt.module.css` — switch container border + box-shadow to new vars

**Created:** none.

---

## Task 1: Add `appearance.cardAccent` default

**Files:**
- Modify: `src/hooks/useSettings.ts:3-17`

- [ ] **Step 1: Add the default**

Open `src/hooks/useSettings.ts`. Find the `DEFAULTS` object (lines 3-17). Add a new entry for `appearance.cardAccent` set to `'brackets'`.

Replace:

```ts
  'appearance.gradientBorder': true,
  'appearance.animationSpeed': 20,
  'appearance.colorMode': 'high',
};
```

with:

```ts
  'appearance.gradientBorder': true,
  'appearance.animationSpeed': 20,
  'appearance.colorMode': 'high',
  'appearance.cardAccent': 'brackets',
};
```

- [ ] **Step 2: Type-check**

Run: `npm run typecheck` (or `npx tsc --noEmit` if no `typecheck` script). Expected: clean.

If unsure of the right command, inspect `package.json` `scripts` first.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useSettings.ts
git commit -m "feat(settings): add appearance.cardAccent default"
```

---

## Task 2: Add new CSS variables and per-style blocks

**Files:**
- Modify: `src/styles/globals.css:32-48`

- [ ] **Step 1: Verify current state of globals.css**

Open `src/styles/globals.css` and locate the block at lines 32-48 — the `/* Card accent system */` comment, the `--accent-tl-*` / `--accent-br-*` vars on `:root`, and the `[data-color-mode="low"]` override.

Confirm the current content matches (whitespace aside):

```css
  /* Card accent system */
  --accent-tl-mask: linear-gradient(180deg, black 0px, black 140px, transparent 160px), linear-gradient(90deg, black 0%, black 12%, transparent 15%);
  --accent-tl-composite: intersect;
  --accent-tl-webkit-composite: source-in;
  --accent-br-mask: linear-gradient(0deg, black 0px, black 140px, transparent 160px), linear-gradient(270deg, black 0%, black 12%, transparent 15%);
  --accent-br-composite: intersect;
  --accent-br-webkit-composite: source-in;
  --accent-br-opacity: 1;
  --shimmer-duration: 8s;
  --window-radius: 10px;
}

[data-color-mode="low"] {
  --accent-tl-mask: linear-gradient(180deg, black 0px, black 140px, transparent 160px), linear-gradient(90deg, black 0%, transparent 2%);
  --accent-br-opacity: 0;
  --shimmer-duration: 30s;
}
```

If different, stop and inform the user before proceeding.

- [ ] **Step 2: Add new vars to `:root`**

Inside the `:root { ... }` block, immediately after the line `--accent-br-opacity: 1;`, add:

```css
  /* Card border + shadow vars consumed by .card rules in card modules.
     Defaults preserve the current bracket appearance. */
  --accent-card-border-top: 1px solid var(--border-card);
  --accent-card-border-right: 1px solid var(--border-card);
  --accent-card-border-bottom: 1px solid var(--border-card);
  --accent-card-border-left: 1px solid var(--border-card);
  --accent-card-shadow: var(--shadow-card);
```

The resulting `:root` accent-system section should read:

```css
  /* Card accent system */
  --accent-tl-mask: linear-gradient(180deg, black 0px, black 140px, transparent 160px), linear-gradient(90deg, black 0%, black 12%, transparent 15%);
  --accent-tl-composite: intersect;
  --accent-tl-webkit-composite: source-in;
  --accent-br-mask: linear-gradient(0deg, black 0px, black 140px, transparent 160px), linear-gradient(270deg, black 0%, black 12%, transparent 15%);
  --accent-br-composite: intersect;
  --accent-br-webkit-composite: source-in;
  --accent-br-opacity: 1;
  --accent-card-border-top: 1px solid var(--border-card);
  --accent-card-border-right: 1px solid var(--border-card);
  --accent-card-border-bottom: 1px solid var(--border-card);
  --accent-card-border-left: 1px solid var(--border-card);
  --accent-card-shadow: var(--shadow-card);
  --shimmer-duration: 8s;
  --window-radius: 10px;
```

- [ ] **Step 3: Add per-style blocks**

Immediately after the closing brace of the existing `[data-color-mode="low"]` block (currently line 48), add the following five blocks:

```css

/* === Card accent styles ===
   `brackets` is the default and uses the existing --accent-tl-mask / --accent-br-mask
   variables already defined on :root. The five styles below disable those masks via a
   fully-transparent gradient and provide their own border / shadow treatment. */

[data-card-accent="stripe-left"] {
  --accent-tl-mask: linear-gradient(transparent, transparent);
  --accent-br-mask: linear-gradient(transparent, transparent);
  --accent-card-border-left: 3px solid var(--accent-color);
}

[data-card-accent="stripe-top"] {
  --accent-tl-mask: linear-gradient(transparent, transparent);
  --accent-br-mask: linear-gradient(transparent, transparent);
  --accent-card-border-top: 2px solid var(--accent-color);
}

[data-card-accent="tinted"] {
  --accent-tl-mask: linear-gradient(transparent, transparent);
  --accent-br-mask: linear-gradient(transparent, transparent);
  --accent-card-border-top: 1px solid color-mix(in srgb, var(--accent-color) 50%, transparent);
  --accent-card-border-right: 1px solid color-mix(in srgb, var(--accent-color) 50%, transparent);
  --accent-card-border-bottom: 1px solid color-mix(in srgb, var(--accent-color) 50%, transparent);
  --accent-card-border-left: 1px solid color-mix(in srgb, var(--accent-color) 50%, transparent);
  --accent-card-shadow:
    0 0 0 1px color-mix(in srgb, var(--accent-color) 15%, transparent),
    0 4px 16px color-mix(in srgb, var(--accent-color) 8%, transparent);
}

[data-card-accent="header-tint"] {
  --accent-tl-mask: linear-gradient(transparent, transparent);
  --accent-br-mask: linear-gradient(transparent, transparent);
  --accent-card-shadow:
    inset 0 32px 0 -16px color-mix(in srgb, var(--accent-color) 10%, transparent),
    inset 0 32px 0 -31px color-mix(in srgb, var(--accent-color) 25%, transparent),
    var(--shadow-card);
}

[data-card-accent="stripe-glow"] {
  --accent-tl-mask: linear-gradient(transparent, transparent);
  --accent-br-mask: linear-gradient(transparent, transparent);
  --accent-card-border-left: 3px solid var(--accent-color);
  --accent-card-shadow:
    -8px 0 24px -12px color-mix(in srgb, var(--accent-color) 35%, transparent),
    var(--shadow-card);
}
```

- [ ] **Step 4: Add the universal low-color-mode override**

Modify the existing `[data-color-mode="low"]` block to additionally swap `--accent-color` to the muted text color, so all six accent styles dim in unison.

Replace:

```css
[data-color-mode="low"] {
  --accent-tl-mask: linear-gradient(180deg, black 0px, black 140px, transparent 160px), linear-gradient(90deg, black 0%, transparent 2%);
  --accent-br-opacity: 0;
  --shimmer-duration: 30s;
}
```

with:

```css
[data-color-mode="low"] {
  --accent-color: var(--text-muted);
  --accent-tl-mask: linear-gradient(180deg, black 0px, black 140px, transparent 160px), linear-gradient(90deg, black 0%, transparent 2%);
  --accent-br-opacity: 0;
  --shimmer-duration: 30s;
}
```

Note: setting `--accent-color` on `[data-color-mode="low"]` works because the existing `.card { --accent-color: var(--color-agent); }` sets the var on `.card`, which is a descendant of the root element. The root selector wins for elements not setting their own `--accent-color`. Card components do set their own, so this override is overridden back per-card. To make low-mode actually take effect, those local `--accent-color` declarations must be replaced — that is done in Task 3.

- [ ] **Step 5: Verify CSS still parses**

Run the dev server briefly to confirm no CSS syntax errors. If a stylelint or build step exists, run it.

```bash
# Inspect package.json for the dev or build script
cat package.json | grep -A 20 '"scripts"'
```

Then run the relevant lint/build command. Expected: no CSS parse errors.

- [ ] **Step 6: Commit**

```bash
git add src/styles/globals.css
git commit -m "feat(styles): add card-accent variables and per-style blocks"
```

---

## Task 3: Refactor card module CSS to use new vars

Goal: change four card modules to read border + box-shadow from `--accent-card-border-*` / `--accent-card-shadow` instead of hard-coded values. Each card module keeps its existing `--accent-color: var(--color-...)` local declaration; the root-level `--accent-color: var(--text-muted)` override added in Task 2 is harmlessly shadowed by these per-card declarations. The non-bracket styles under low-color mode will therefore continue to show their role color — that's an accepted trade-off, listed as out-of-scope at the bottom of this plan.

**Files (all modified together — same shape of edit):**
- Modify: `src/components/AgentStepCard.module.css:1-11`
- Modify: `src/components/InlineAIBlock.module.css:110-118`
- Modify: `src/components/CommandBlock.module.css:1-11`
- Modify: `src/components/ApprovalPrompt.module.css` (find the container rule with `border: 1px solid var(--border-card)` and `box-shadow: var(--shadow-card)`)

- [ ] **Step 1: Inspect ApprovalPrompt to confirm its container selector**

Run: read `src/components/ApprovalPrompt.module.css`, lines 1-50. Identify the selector that has `background: var(--bg-card)`, `border: 1px solid var(--border-card)`, and `box-shadow: var(--shadow-card)`. Note the selector name (e.g. `.container`, `.prompt`).

- [ ] **Step 2: Edit `AgentStepCard.module.css`**

Open `src/components/AgentStepCard.module.css`. Replace the `.card` rule (currently lines 1-11) with:

```css
/* Card treatment */
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
  margin-bottom: 8px;
  animation: fadeIn 0.2s ease;
}
```

Leave the `.card::before` and `.card::after` rules unchanged.

- [ ] **Step 3: Edit `InlineAIBlock.module.css`**

Open `src/components/InlineAIBlock.module.css`. Replace the `.block` rule (currently lines 110-118) with:

```css
/* Card treatment */
.block {
  --accent-color: var(--color-ai);
  position: relative;
  background: var(--bg-card);
  border-top: var(--accent-card-border-top);
  border-right: var(--accent-card-border-right);
  border-bottom: var(--accent-card-border-bottom);
  border-left: var(--accent-card-border-left);
  border-radius: 10px;
  box-shadow: var(--accent-card-shadow);
}
```

Leave the `.block::before` and `.block::after` rules unchanged.

- [ ] **Step 4: Edit `CommandBlock.module.css`**

Open `src/components/CommandBlock.module.css`. Replace the `.block` rule (currently lines 1-11) with:

```css
.block {
  position: relative;
  font-size: 13px;
  margin-bottom: 8px;
  padding: 14px 16px;
  background: var(--bg-card);
  border-top: var(--accent-card-border-top);
  border-right: var(--accent-card-border-right);
  border-bottom: var(--accent-card-border-bottom);
  border-left: var(--accent-card-border-left);
  border-radius: 10px;
  box-shadow: var(--accent-card-shadow);
  transition: border-color 0.2s;
}
```

(`CommandBlock` does not declare `--accent-color` locally; it inherits from its parent card. Keep that behavior.)

Leave `.block::before` and `.block::after` unchanged.

- [ ] **Step 5: Edit `ApprovalPrompt.module.css`**

Using the selector name identified in Step 1 (referred to here as `<SELECTOR>`), replace the rule's `border` and `box-shadow` declarations.

Find lines that look like:

```css
.<SELECTOR> {
  --accent-color: var(--color-agent);
  position: relative;
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: 10px;
  box-shadow: var(--shadow-card);
  /* ... */
}
```

Replace the `border` and `box-shadow` lines so the rule reads:

```css
.<SELECTOR> {
  --accent-color: var(--color-agent);
  position: relative;
  background: var(--bg-card);
  border-top: var(--accent-card-border-top);
  border-right: var(--accent-card-border-right);
  border-bottom: var(--accent-card-border-bottom);
  border-left: var(--accent-card-border-left);
  border-radius: 10px;
  box-shadow: var(--accent-card-shadow);
  /* ... rest of declarations unchanged ... */
}
```

Leave the `::before` and `::after` rules in that file unchanged.

- [ ] **Step 6: Build to confirm no CSS issues**

Run the same lint/build command you used in Task 2 Step 5. Expected: clean.

- [ ] **Step 7: Manual smoke test — brackets still look right**

Run the dev server (consult `package.json` `scripts` — likely `npm run dev` or `npm start`). With no setting written, `appearance.cardAccent` defaults to `brackets`. Open the app, trigger an AgentStepCard, an InlineAIBlock, a CommandBlock, and an ApprovalPrompt. Visually confirm the corner-bracket accent appears on each, matching what it looked like before this change.

If anything shifted (e.g. card border now visible where it shouldn't be because the masks no longer hide it), stop and diagnose before continuing.

- [ ] **Step 8: Commit**

```bash
git add src/components/AgentStepCard.module.css \
        src/components/InlineAIBlock.module.css \
        src/components/CommandBlock.module.css \
        src/components/ApprovalPrompt.module.css
git commit -m "refactor(cards): drive border and shadow from accent vars"
```

---

## Task 4: Apply `data-card-accent` in `App.tsx`

**Files:**
- Modify: `src/App.tsx:164-167`

- [ ] **Step 1: Read the setting**

Open `src/App.tsx`. Find line 164:

```tsx
  const colorMode = config['appearance.colorMode'] || 'high';
```

Add immediately after it:

```tsx
  const cardAccent = config['appearance.cardAccent'] || 'brackets';
```

- [ ] **Step 2: Apply the data attribute**

On line 167 (the root `<div>` with `data-color-mode={colorMode}`), add the new attribute:

Replace:

```tsx
    <div data-color-mode={colorMode} className={maximized ? undefined : 'window-frame'} style={{
```

with:

```tsx
    <div data-color-mode={colorMode} data-card-accent={cardAccent} className={maximized ? undefined : 'window-frame'} style={{
```

- [ ] **Step 3: Type-check**

Run: `npm run typecheck` (or `npx tsc --noEmit`). Expected: clean.

- [ ] **Step 4: Manually verify a non-default style renders**

With dev server running, edit your local config (or use DevTools console) to temporarily set `appearance.cardAccent` to `stripe-left` and reload the app. Confirm cards now show a 3px orange/purple/green left border instead of brackets.

DevTools console method:
```js
await window.tai.config.set('appearance.cardAccent', 'stripe-left');
location.reload();
```

Repeat briefly for `stripe-top`, `tinted`, `header-tint`, `stripe-glow`. Confirm each renders.

Then restore to brackets:
```js
await window.tai.config.set('appearance.cardAccent', 'brackets');
location.reload();
```

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "feat(app): apply data-card-accent from appearance setting"
```

---

## Task 5: Add Card Accent dropdown to QuickSettings

**Files:**
- Modify: `src/components/QuickSettings.tsx:7-31, 112, 194` (props interface, options list, JSX row)
- Modify: `src/App.tsx:219-236` (pass new props)

- [ ] **Step 1: Add prop to interface**

In `src/components/QuickSettings.tsx`, find the `QuickSettingsProps` interface (lines 7-24). Add two new lines immediately after `onColorModeChange`:

Replace:

```tsx
  colorMode: string;
  onColorModeChange: (mode: string) => void;
  trustLevel: TrustLevel;
```

with:

```tsx
  colorMode: string;
  onColorModeChange: (mode: string) => void;
  cardAccent: string;
  onCardAccentChange: (value: string) => void;
  trustLevel: TrustLevel;
```

- [ ] **Step 2: Add the options constant**

Find `COLOR_MODE_OPTIONS` (lines 28-31). Add a new constant immediately after it:

```tsx
const CARD_ACCENT_OPTIONS = [
  { value: 'brackets', label: 'Corner Brackets' },
  { value: 'stripe-left', label: 'Left Stripe' },
  { value: 'stripe-top', label: 'Top Stripe' },
  { value: 'tinted', label: 'Tinted Border' },
  { value: 'header-tint', label: 'Header Tint' },
  { value: 'stripe-glow', label: 'Stripe + Glow' },
];
```

- [ ] **Step 3: Destructure the new props**

Find the function signature on line 112:

```tsx
export function QuickSettings({ visible, onClose, colorMode, onColorModeChange, trustLevel, onTrustLevelChange, aiProvider, onAIProviderChange, claudeModel, onClaudeModelChange, claudeEffort, onClaudeEffortChange, expandToolCalls, onExpandToolCallsChange, systemNotifications, onSystemNotificationsChange }: QuickSettingsProps) {
```

Add `cardAccent` and `onCardAccentChange` after `onColorModeChange`:

```tsx
export function QuickSettings({ visible, onClose, colorMode, onColorModeChange, cardAccent, onCardAccentChange, trustLevel, onTrustLevelChange, aiProvider, onAIProviderChange, claudeModel, onClaudeModelChange, claudeEffort, onClaudeEffortChange, expandToolCalls, onExpandToolCallsChange, systemNotifications, onSystemNotificationsChange }: QuickSettingsProps) {
```

- [ ] **Step 4: Add the dropdown row**

Find the Color Mode row (lines 187-194):

```tsx
                <div className={styles.settingRow}>
                  <span className={styles.settingLabel}>Color Mode</span>
                  <CustomDropdown
                    value={colorMode}
                    options={COLOR_MODE_OPTIONS}
                    onChange={onColorModeChange}
                  />
                </div>
```

Insert a new row immediately after its closing `</div>`:

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

- [ ] **Step 5: Pass the new props from `App.tsx`**

Open `src/App.tsx`. Find the `<QuickSettings ... />` element (lines 219-236). Add two new prop lines immediately after `onColorModeChange={(mode) => setSetting('appearance.colorMode', mode)}`:

Replace:

```tsx
        colorMode={colorMode}
        onColorModeChange={(mode) => setSetting('appearance.colorMode', mode)}
        trustLevel={activeTab.trustLevel}
```

with:

```tsx
        colorMode={colorMode}
        onColorModeChange={(mode) => setSetting('appearance.colorMode', mode)}
        cardAccent={cardAccent}
        onCardAccentChange={(value) => setSetting('appearance.cardAccent', value)}
        trustLevel={activeTab.trustLevel}
```

- [ ] **Step 6: Type-check**

Run: `npm run typecheck` (or `npx tsc --noEmit`). Expected: clean.

- [ ] **Step 7: Manual UI test**

Run the dev server. Open Quick Settings. In the General category, find the new "Card Accent" dropdown directly below "Color Mode". Select each of the six options and visually confirm cards in the active session update:

1. Corner Brackets — current bracket look
2. Left Stripe — 3px solid left bar in accent color
3. Top Stripe — 2px solid top bar in accent color
4. Tinted Border — full thin tinted border + soft halo
5. Header Tint — top ~32px gradient wash + hairline
6. Stripe + Glow — left stripe with outer glow on the left

Verify across all four card surfaces (AgentStepCard, InlineAIBlock, CommandBlock, ApprovalPrompt) — easiest by triggering an AI prompt that produces all four.

Also confirm: after selecting a style and reloading the app, the selection persists (it's read from config on startup).

- [ ] **Step 8: Commit**

```bash
git add src/components/QuickSettings.tsx src/App.tsx
git commit -m "feat(settings): add Card Accent dropdown in Quick Settings"
```

---

## Task 6: Final verification

- [ ] **Step 1: Run the full type-check and build**

```bash
npm run typecheck  # or npx tsc --noEmit
npm run build      # if a build script exists; consult package.json
```

Expected: both clean.

- [ ] **Step 2: Verify all six styles against `data-color-mode="low"`**

In Quick Settings, switch Color Mode to `Low`. Cycle through each Card Accent value and confirm:
- `brackets` — dims to the existing low-mode appearance (no BR, faded TL). Unchanged from today.
- `stripe-left` / `stripe-top` / `tinted` / `header-tint` / `stripe-glow` — render in their role colors as before. (The decision to leave non-bracket styles unaffected by low mode was deliberate; revisit only if the user asks.)

Switch back to High.

- [ ] **Step 3: Verify default behavior on a fresh install**

In a clean config (delete the `appearance.cardAccent` key from your local config file or run a fresh dev install), restart the app and confirm cards show the bracket accent — the default.

- [ ] **Step 4: Final commit (if any docs need an update)**

If nothing else changed, skip. Otherwise:

```bash
git add <files>
git commit -m "docs: ..."
```

---

## Out of scope (documented for completeness)

- Stronger dimming of non-bracket accent styles under `data-color-mode="low"` (the `--accent-color` cascade can't reach card descendants that set their own role color; would need refactoring each card to read from `--accent-color-role` or similar). Revisit if the user reports the styles look too saturated in low mode.
- Animated transitions when switching between accent styles. Currently a hard cut; matches Color Mode's behavior.
- Per-card-type accent overrides (e.g. always use `stripe-left` for InlineAIBlock regardless of setting). Not requested.
