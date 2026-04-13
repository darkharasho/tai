# UI Redesign — Evolved Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign Tai's UI with refined colors (#8b5cf6 AI, #ea580c agent), Geist Sans for UI chrome, CSS modules migration, full production surface treatments (noise, frosted glass, elevated cards), and GradientBorder removal.

**Architecture:** Visual-only changes across 13 components + globals. Each component gets a `.module.css` file extracting static styles. Dynamic styles (mode colors, active states) remain inline. Global foundation (tokens, noise, accent line) laid first, then components migrated one at a time.

**Tech Stack:** React, CSS Modules (Vite built-in), Geist font (npm), Vitest

**Spec:** `docs/superpowers/specs/2026-04-12-ui-redesign-design.md`

---

## File Map

### New Files
- `src/components/TabBar.module.css`
- `src/components/CommandBlock.module.css`
- `src/components/TerminalInput.module.css`
- `src/components/InlineAIBlock.module.css`
- `src/components/BlockList.module.css`
- `src/components/ApprovalPrompt.module.css`
- `src/components/AgentStepCard.module.css`
- `src/components/SettingsOverlay.module.css`
- `src/components/ConfirmModal.module.css`
- `src/components/UpdateNotifier.module.css`
- `src/components/WhatsNewModal.module.css`
- `src/components/ErrorAffordance.module.css`
- `src/components/TrustBadge.module.css`

### Modified Files
- `src/styles/globals.css` — new tokens, font import, noise texture, default font
- `src/App.tsx` — remove GradientBorder, add accent line
- `src/components/TabBar.tsx` — CSS module import, frosted glass, Geist Sans
- `src/components/CommandBlock.tsx` — CSS module import, card treatment
- `src/components/TerminalInput.tsx` — CSS module import, premium input
- `src/components/InlineAIBlock.tsx` — CSS module import, card treatment
- `src/components/BlockList.tsx` — CSS module import
- `src/components/ApprovalPrompt.tsx` — CSS module import, card treatment
- `src/components/AgentStepCard.tsx` — CSS module import, card treatment
- `src/components/SettingsOverlay.tsx` — CSS module import
- `src/components/ConfirmModal.tsx` — CSS module import
- `src/components/UpdateNotifier.tsx` — CSS module import
- `src/components/WhatsNewModal.tsx` — CSS module import
- `src/components/ErrorAffordance.tsx` — CSS module import
- `src/components/TrustBadge.tsx` — CSS module import

### Deleted Files
- `src/components/GradientBorder.tsx`

---

### Task 1: Install Geist Font

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install the geist npm package**

Run: `npm install geist`

- [ ] **Step 2: Verify installation**

Run: `ls node_modules/geist/dist/fonts/geist-sans/style.css`
Expected: File exists

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: install geist font package"
```

---

### Task 2: Update Global Design Tokens

**Files:**
- Modify: `src/styles/globals.css`

- [ ] **Step 1: Add Geist font import at the top of globals.css**

Add as the first line of the file:

```css
@import 'geist/dist/fonts/geist-sans/style.css';
```

- [ ] **Step 2: Update CSS variables in `:root`**

Replace the existing `:root` block with:

```css
:root {
  --bg-base: #0c0f11;
  --bg-surface: #111418;
  --bg-mid: #0e1114;
  --bg-input: #161a1f;
  --bg-elevated: #1c2027;
  --bg-hover: #21292f;
  --border-subtle: #1e2228;
  --text-primary: #bec6d0;
  --text-secondary: #a0acbb;
  --text-muted: #5a6a7a;
  --color-shell: #00a884;
  --color-ai: #8b5cf6;
  --color-agent: #ea580c;
  --color-error: #E35535;
  --color-warning: #c7910c;
  --color-info: #11B7D4;
  --font-mono: 'Fira Code', 'Cascadia Code', 'JetBrains Mono', 'Source Code Pro', 'Symbols Nerd Font Mono', monospace;
  --font-sans: 'Geist', system-ui, sans-serif;
  --bg-card: rgba(255, 255, 255, 0.025);
  --border-card: rgba(255, 255, 255, 0.05);
  --shadow-card: 0 1px 3px rgba(0, 0, 0, 0.2);
}
```

- [ ] **Step 3: Change default body font from mono to sans**

In the `html, body, #root` rule, change `font-family: var(--font-mono);` to `font-family: var(--font-sans);`

- [ ] **Step 4: Update selection color**

Change `::selection` background from `rgba(168, 85, 247, 0.3)` to `rgba(139, 92, 246, 0.3)`.

- [ ] **Step 5: Add noise texture pseudo-element on #root**

Add after the `html, body, #root` block:

```css
#root {
  position: relative;
}

#root::after {
  content: '';
  position: fixed;
  inset: 0;
  opacity: 0.03;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
  pointer-events: none;
  z-index: 9999;
}
```

- [ ] **Step 6: Add shimmer animation for top accent line**

Add after the existing `@keyframes` blocks:

```css
@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
```

- [ ] **Step 7: Verify build compiles**

Run: `npm run build`
Expected: Successful compilation, no errors

- [ ] **Step 8: Commit**

```bash
git add src/styles/globals.css
git commit -m "feat: update design tokens, add Geist font, noise texture, shimmer animation"
```

---

### Task 3: Remove GradientBorder and Add Accent Line

**Files:**
- Modify: `src/App.tsx`
- Delete: `src/components/GradientBorder.tsx`

- [ ] **Step 1: Remove GradientBorder from App.tsx**

In `src/App.tsx`, remove the import line:
```tsx
import { GradientBorder } from './components/GradientBorder';
```

Note: `GradientBorder` is not currently used in App.tsx (it was removed from the JSX previously but the import may still exist). Check and remove if present.

- [ ] **Step 2: Add the top accent line as the first child inside the root div in App.tsx**

Add as the first child inside the outermost `<div>` in the return statement:

```tsx
<div style={{
  height: 2,
  background: 'linear-gradient(90deg, transparent, #00a884, #8b5cf6, #ea580c, transparent)',
  backgroundSize: '200% 100%',
  animation: 'shimmer 8s linear infinite',
  flexShrink: 0,
}} />
```

- [ ] **Step 3: Delete GradientBorder.tsx**

Run: `rm src/components/GradientBorder.tsx`

- [ ] **Step 4: Verify build compiles**

Run: `npm run build`
Expected: Successful compilation, no references to GradientBorder remain

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git rm src/components/GradientBorder.tsx
git commit -m "feat: replace GradientBorder with top accent line"
```

---

### Task 4: Migrate TabBar to CSS Modules + Redesign

**Files:**
- Create: `src/components/TabBar.module.css`
- Modify: `src/components/TabBar.tsx`

- [ ] **Step 1: Create TabBar.module.css**

Create `src/components/TabBar.module.css` with all static styles extracted from the component. This file contains the frosted glass tab bar, active tab styles, separator, and window controls:

```css
.bar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  background: linear-gradient(180deg, rgba(19, 23, 32, 0.95) 0%, rgba(17, 20, 24, 0.9) 100%);
  backdrop-filter: blur(8px);
  -webkit-app-region: drag;
  user-select: none;
  min-height: 44px;
}

.tabsContainer {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.tab {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 16px;
  height: 100%;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
  white-space: nowrap;
  flex-shrink: 0;
  -webkit-app-region: no-drag;
  border-bottom: 2px solid transparent;
  font-family: var(--font-sans);
}

.tabActive {
  border-bottom-color: currentColor;
  position: relative;
}

.tabIndex {
  font-size: 11px;
  font-weight: 500;
  font-family: var(--font-sans);
}

.tabLabel {
  font-size: 12.5px;
  font-weight: 500;
  font-family: var(--font-sans);
  letter-spacing: 0.2px;
}

.tabLabelActive {
  font-weight: 600;
  color: #e8ecf0;
}

.tabGlow {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 20px;
  pointer-events: none;
}

.statusDot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
}

.editInput {
  background: transparent;
  border: none;
  color: var(--text-primary);
  font-family: var(--font-sans);
  font-size: 12.5px;
  outline: none;
  width: 80px;
}

.closeBtn {
  color: var(--text-muted);
  cursor: pointer;
}

.measureContainer {
  display: flex;
  gap: 4px;
  position: absolute;
  visibility: hidden;
  pointer-events: none;
  height: 0;
  overflow: hidden;
}

.overflowWrapper {
  position: relative;
  flex-shrink: 0;
  -webkit-app-region: no-drag;
}

.overflowBtn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 8px;
  border-radius: 6px;
  cursor: pointer;
}

.overflowDropdown {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 4px;
  background: var(--bg-elevated);
  border: 1px solid var(--border-card);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  z-index: 3000;
  min-width: 180px;
  padding: 4px 0;
  max-height: 300px;
  overflow-y: auto;
}

.overflowItem {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  cursor: pointer;
  border-left: 2px solid transparent;
  font-family: var(--font-sans);
}

.overflowItemLabel {
  font-size: 12px;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fixedControls {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.addBtn {
  display: flex;
  align-items: center;
  padding: 6px 10px;
  border-radius: 6px;
  cursor: pointer;
  flex-shrink: 0;
  -webkit-app-region: no-drag;
}

.separator {
  width: 1px;
  background: var(--border-subtle);
  margin: 8px 4px;
  align-self: stretch;
}

.windowControls {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
  -webkit-app-region: no-drag;
}

.windowBtn {
  background: transparent;
  border: none;
  padding: 4px 8px;
  cursor: pointer;
  display: flex;
  align-items: center;
  border-radius: 4px;
  color: #4a5060;
}
```

- [ ] **Step 2: Update TabBar.tsx to import and use CSS module**

In `src/components/TabBar.tsx`:

1. Add import at top: `import styles from './TabBar.module.css';`
2. Replace all inline `style={{}}` props with `className={styles.xxx}` references
3. Keep dynamic styles inline — specifically:
   - Active tab `borderBottomColor` set to `modeColor`
   - Active tab `background` set to `linear-gradient(180deg, rgba(mode-color, 0.08), rgba(mode-color, 0.03))`
   - Tab glow `background` set to `radial-gradient(ellipse at center bottom, rgba(mode-color, 0.15), transparent 70%)`
   - Status dot `background` and `boxShadow` set to mode color with glow (`0 0 8px rgba(mode-color, 0.5)`)
   - Overflow button active indicator colors
   - Tab index color matching mode color for non-shell tabs
4. Inactive tab labels use `color: #6a7080`
5. Remove all `WebkitAppRegion` from inline styles (now in CSS via `-webkit-app-region`)
6. Add separator div between add button and window controls: `<div className={styles.separator} />`

- [ ] **Step 3: Verify build compiles**

Run: `npm run build`
Expected: Successful compilation

- [ ] **Step 4: Run existing tests**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add src/components/TabBar.module.css src/components/TabBar.tsx
git commit -m "feat: migrate TabBar to CSS modules with frosted glass redesign"
```

---

### Task 5: Migrate CommandBlock to CSS Modules + Card Treatment

**Files:**
- Create: `src/components/CommandBlock.module.css`
- Modify: `src/components/CommandBlock.tsx`

- [ ] **Step 1: Create CommandBlock.module.css**

Create `src/components/CommandBlock.module.css` extracting the existing `const styles` template literal and applying card treatment:

```css
.block {
  font-size: 14px;
  margin-bottom: 8px;
  padding: 14px 16px;
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: 10px;
  box-shadow: var(--shadow-card);
  position: relative;
}

.block::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 10px;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
  pointer-events: none;
}

.active {
  /* active state applied via dynamic border-left */
}

.collapsed {
  font-size: 14px;
  padding: 4px 16px;
  margin-bottom: 4px;
  opacity: 0.3;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  transition: opacity 0.15s;
  font-family: var(--font-mono);
}

.collapsed:hover {
  opacity: 0.5;
}

.promptLine {
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
  user-select: none;
  min-height: 22px;
}

.promptLeft {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  overflow: hidden;
  font-family: var(--font-mono);
}

.promptRight {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  margin-left: 12px;
}

.promptUser {
  font-weight: 600;
  flex-shrink: 0;
  font-family: var(--font-mono);
}

.promptPath {
  color: #3b82f6;
  flex-shrink: 0;
  font-family: var(--font-mono);
}

.promptSep {
  color: var(--text-muted);
  flex-shrink: 0;
  font-family: var(--font-mono);
}

.cmd {
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: var(--font-mono);
}

.cmdDim {
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  min-width: 0;
  font-family: var(--font-mono);
}

.viaAi {
  color: var(--color-ai);
  font-size: 10px;
  opacity: 0.5;
  flex-shrink: 0;
  font-family: var(--font-sans);
}

.meta {
  color: var(--text-muted);
  font-size: 10px;
  flex-shrink: 0;
  font-family: var(--font-sans);
  background: rgba(255, 255, 255, 0.04);
  padding: 2px 8px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.separator {
  height: 1px;
  margin: 8px 0;
}

.running {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-shell);
  animation: pulse 1.5s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.25; }
}

.awaiting {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  font-weight: 600;
  color: #eab308;
  letter-spacing: 0.5px;
  animation: pulse 2s ease-in-out infinite;
  font-family: var(--font-sans);
}

.awaitingDot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #eab308;
}

.outputArea {
  margin-top: 2px;
  margin-left: 2px;
}

.output {
  color: var(--text-primary);
  font-size: 13px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;
  font-family: var(--font-mono);
}

.showMore {
  font-size: 11px;
  color: var(--text-muted);
  cursor: pointer;
  padding-top: 2px;
  opacity: 0.7;
  font-family: var(--font-sans);
}

.showMore:hover {
  color: #58a6ff;
  opacity: 1;
}

.link {
  color: #58a6ff;
  text-decoration: none;
  cursor: pointer;
  position: relative;
}

.link:hover {
  text-decoration: underline;
}

.link::after {
  content: 'Ctrl+Click to open';
  position: absolute;
  bottom: 100%;
  left: 0;
  padding: 2px 6px;
  background: #1e1e2e;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 3px;
  font-size: 10px;
  color: var(--text-muted);
  white-space: nowrap;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.15s;
  z-index: 10;
}

.link:hover::after {
  opacity: 1;
}
```

- [ ] **Step 2: Update CommandBlock.tsx**

1. Remove the `const styles = \`...\`` template literal at the bottom
2. Remove all `<style>{styles}</style>` elements from the JSX
3. Add import: `import styles from './CommandBlock.module.css';`
4. Replace all `className="cb-xxx"` with `className={styles.xxx}` (map `cb-block` → `styles.block`, `cb-collapsed` → `styles.collapsed`, etc.)
5. Add dynamic left accent as inline style on `.block`: `borderLeft: \`2px solid \${isRemote ? 'var(--color-agent)' : 'var(--color-shell)'}\``
6. For the left accent gradient, add inline style: `style={{ borderImage: \`linear-gradient(180deg, \${modeColor}, transparent) 1\` }}`
7. Add separator div between prompt and output: `<div className={styles.separator} style={{ background: \`linear-gradient(90deg, rgba(\${modeColorRgb}, 0.12), transparent 60%)\` }} />`
8. Update the link class references in `ansiToHtml` output — the CSS module class names are scoped, so links in `dangerouslySetInnerHTML` need global class. Add `:global(.cb-link)` to the module for the link styles, keeping the `.cb-link` classname in the HTML output.

- [ ] **Step 3: Verify build compiles**

Run: `npm run build`
Expected: Successful compilation

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add src/components/CommandBlock.module.css src/components/CommandBlock.tsx
git commit -m "feat: migrate CommandBlock to CSS modules with card treatment"
```

---

### Task 6: Migrate TerminalInput to CSS Modules + Premium Input

**Files:**
- Create: `src/components/TerminalInput.module.css`
- Modify: `src/components/TerminalInput.tsx`

- [ ] **Step 1: Create TerminalInput.module.css**

Create `src/components/TerminalInput.module.css` extracting the existing `<style>` block and applying premium input treatment:

```css
.wrapper {
  padding: 8px 14px 10px;
  flex-shrink: 0;
}

.box {
  position: relative;
  border-radius: 10px;
  background: linear-gradient(180deg, #181c22 0%, #161a1f 100%);
  overflow: visible;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

.box::before {
  content: '';
  position: absolute;
  inset: -1.5px;
  border-radius: 11.5px;
  padding: 1.5px;
  background: linear-gradient(135deg, var(--color-shell) 0%, #007a60 30%, #005a47 50%, #007a60 70%, var(--color-shell) 100%);
  background-size: 300% 300%;
  animation: gradientSweep 20s ease-in-out infinite alternate;
  -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor;
  mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  mask-composite: exclude;
  pointer-events: none;
  z-index: 0;
  opacity: 0.5;
  transition: opacity 0.2s ease;
}

.box::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 10px;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
  pointer-events: none;
  z-index: 1;
}

.box:focus-within::before {
  opacity: 0.8;
}

.boxAi::before {
  background: linear-gradient(135deg, var(--color-ai) 0%, #7048b8 30%, #5a3494 50%, #7048b8 70%, var(--color-ai) 100%);
  background-size: 300% 300%;
  animation: gradientSweep 20s ease-in-out infinite alternate;
}

.boxRemote::before {
  background: linear-gradient(135deg, var(--color-agent) 0%, #c44d0a 30%, #8a3808 50%, #c44d0a 70%, var(--color-agent) 100%);
  background-size: 300% 300%;
  animation: gradientSweep 20s ease-in-out infinite alternate;
}

.row {
  position: relative;
  z-index: 1;
  padding: 11px 16px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: var(--font-mono);
  font-size: 13px;
}

.user {
  color: var(--color-shell);
  flex-shrink: 0;
  font-size: 13px;
  font-weight: 600;
  font-family: var(--font-mono);
}

.path {
  color: var(--color-info);
  flex-shrink: 0;
  font-size: 13px;
  font-family: var(--font-mono);
}

.dollar {
  color: var(--text-muted);
  flex-shrink: 0;
  font-family: var(--font-mono);
}

.promptAi {
  color: var(--color-ai);
  font-size: 14px;
  flex-shrink: 0;
}

.fieldWrap {
  flex: 1;
  position: relative;
  min-width: 0;
}

.ghost {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  pointer-events: none;
  color: rgba(255, 255, 255, 0.15);
  font-family: var(--font-mono);
  font-size: 13px;
  white-space: pre;
  overflow: hidden;
}

.field {
  position: relative;
  width: 100%;
  background: none;
  border: none;
  outline: none;
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: 13px;
  min-width: 0;
}

.field::placeholder {
  color: var(--text-muted);
}

.hint {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  margin-left: auto;
}

.kbd {
  color: var(--text-muted);
  font-size: 10px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  padding: 2px 7px;
  border-radius: 4px;
  background: rgba(12, 15, 17, 0.6);
  backdrop-filter: blur(4px);
  font-family: var(--font-sans);
}

.hintLabel {
  color: var(--text-muted);
  font-size: 10px;
  font-weight: 500;
  font-family: var(--font-sans);
}

.tabPopup {
  background: var(--bg-elevated);
  border: 1px solid var(--border-card);
  border-radius: 5px;
  padding: 4px 0;
  margin-bottom: 4px;
  max-height: 200px;
  overflow-y: auto;
  font-family: var(--font-mono);
  font-size: 12px;
  display: flex;
  flex-wrap: wrap;
  gap: 0;
}

.tabItem {
  padding: 3px 10px;
  color: var(--text-secondary);
  white-space: nowrap;
  border-radius: 3px;
  margin: 1px 3px;
}

.tabItemActive {
  background: var(--color-shell);
  color: var(--bg-base);
}

@keyframes gradientSweep {
  0% { background-position: 0% 0%; }
  100% { background-position: 100% 100%; }
}
```

- [ ] **Step 2: Update TerminalInput.tsx**

1. Remove the `<style>{\`...\`}</style>` block from the JSX
2. Add import: `import styles from './TerminalInput.module.css';`
3. Replace all `className="tn-xxx"` with `className={styles.xxx}` (map `tn-input-wrapper` → `styles.wrapper`, `tn-input-box` → `styles.box`, etc.)
4. For the AI/remote class toggling, use template literals: `` className={`${styles.box} ${isAI ? styles.boxAi : ''} ${promptIsRemote ? styles.boxRemote : ''}`} ``
5. For tab completion items: `` className={`${styles.tabItem} ${i === tabIndex ? styles.tabItemActive : ''}`} ``
6. Remove inline `style` objects that are now in the CSS module
7. Keep dynamic `style={{ color: '#d4770c' }}` on the remote user span — update to `'var(--color-agent)'`

- [ ] **Step 3: Verify build compiles**

Run: `npm run build`
Expected: Successful compilation

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add src/components/TerminalInput.module.css src/components/TerminalInput.tsx
git commit -m "feat: migrate TerminalInput to CSS modules with premium input design"
```

---

### Task 7: Migrate InlineAIBlock to CSS Modules + Card Treatment

**Files:**
- Create: `src/components/InlineAIBlock.module.css`
- Modify: `src/components/InlineAIBlock.tsx`

- [ ] **Step 1: Read InlineAIBlock.tsx to extract current styles**

Read `src/components/InlineAIBlock.tsx` to understand the existing CSS-in-JS styles. The component has ~220 lines of CSS in a template literal.

- [ ] **Step 2: Create InlineAIBlock.module.css**

Extract all styles from the component's template literal into `src/components/InlineAIBlock.module.css`. Apply card treatment:
- Main block gets `var(--bg-card)` background, `var(--border-card)` border, `border-radius: 10px`, `var(--shadow-card)`, inset highlight
- Left accent in `var(--color-ai)` with vertical gradient fade
- Code blocks inside get elevated sub-surface: `rgba(255, 255, 255, 0.015)` background
- Text elements that are UI chrome (headers, labels, buttons) use `var(--font-sans)`
- Code content uses `var(--font-mono)`

Map the existing class names (prefixed with `ai-`) to camelCase module names.

- [ ] **Step 3: Update InlineAIBlock.tsx**

1. Remove the `const styles = \`...\`` template literal
2. Remove `<style>{styles}</style>` from JSX
3. Add import: `import styles from './InlineAIBlock.module.css';`
4. Replace `className="ai-xxx"` with `className={styles.xxx}`
5. Keep dynamic inline styles for streaming state, duration visibility, etc.

- [ ] **Step 4: Verify build compiles**

Run: `npm run build`
Expected: Successful compilation

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/components/InlineAIBlock.module.css src/components/InlineAIBlock.tsx
git commit -m "feat: migrate InlineAIBlock to CSS modules with card treatment"
```

---

### Task 8: Migrate BlockList to CSS Modules

**Files:**
- Create: `src/components/BlockList.module.css`
- Modify: `src/components/BlockList.tsx`

- [ ] **Step 1: Read BlockList.tsx to extract current styles**

Read `src/components/BlockList.tsx` to understand the ~100 lines of scoped CSS.

- [ ] **Step 2: Create BlockList.module.css**

Extract all styles from the component into `src/components/BlockList.module.css`. Map class names to camelCase. Apply `var(--font-sans)` to any UI chrome text (welcome message, labels). Keep mono for any code-related text.

- [ ] **Step 3: Update BlockList.tsx**

1. Remove the styles template literal and `<style>` tag
2. Add import: `import styles from './BlockList.module.css';`
3. Replace className references

- [ ] **Step 4: Verify build and tests**

Run: `npm run build && npm test`
Expected: Build succeeds, all tests pass

- [ ] **Step 5: Commit**

```bash
git add src/components/BlockList.module.css src/components/BlockList.tsx
git commit -m "feat: migrate BlockList to CSS modules"
```

---

### Task 9: Migrate ApprovalPrompt to CSS Modules + Card Treatment

**Files:**
- Create: `src/components/ApprovalPrompt.module.css`
- Modify: `src/components/ApprovalPrompt.tsx`

- [ ] **Step 1: Create ApprovalPrompt.module.css**

Extract inline styles into CSS module. Apply card treatment with `--color-agent` left accent. Buttons use `var(--font-sans)`.

```css
.container {
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: 10px;
  border-left: 2px solid var(--color-agent);
  box-shadow: var(--shadow-card);
  padding: 14px 16px;
  margin-bottom: 8px;
  position: relative;
}

.container::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 10px;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
  pointer-events: none;
}

.commandPreview {
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--text-primary);
  padding: 8px 12px;
  background: rgba(234, 88, 12, 0.06);
  border-radius: 6px;
  margin-bottom: 10px;
}

.actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.btn {
  font-family: var(--font-sans);
  font-size: 12px;
  font-weight: 500;
  padding: 6px 14px;
  border-radius: 6px;
  border: 1px solid var(--border-card);
  cursor: pointer;
  background: var(--bg-elevated);
  color: var(--text-primary);
  transition: background 0.15s;
}

.btn:hover {
  background: var(--bg-hover);
}

.btnApprove {
  background: var(--color-shell);
  color: var(--bg-base);
  border-color: transparent;
}

.btnApprove:hover {
  background: #00bf96;
}

.kbdHint {
  font-family: var(--font-sans);
  font-size: 10px;
  color: var(--text-muted);
}

.resolved {
  opacity: 0.4;
  transition: opacity 0.3s;
}
```

- [ ] **Step 2: Update ApprovalPrompt.tsx**

1. Add import: `import styles from './ApprovalPrompt.module.css';`
2. Replace inline styles with CSS module classes
3. Keep dynamic opacity for resolved state as inline style

- [ ] **Step 3: Verify build and tests**

Run: `npm run build && npm test`
Expected: Build succeeds, all tests pass

- [ ] **Step 4: Commit**

```bash
git add src/components/ApprovalPrompt.module.css src/components/ApprovalPrompt.tsx
git commit -m "feat: migrate ApprovalPrompt to CSS modules with card treatment"
```

---

### Task 10: Migrate AgentStepCard to CSS Modules + Card Treatment

**Files:**
- Create: `src/components/AgentStepCard.module.css`
- Modify: `src/components/AgentStepCard.tsx`

- [ ] **Step 1: Create AgentStepCard.module.css**

Extract inline styles. Apply card treatment with `--color-agent` left accent. Status icons get `box-shadow` glow.

```css
.card {
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: 10px;
  border-left: 2px solid var(--color-agent);
  box-shadow: var(--shadow-card);
  padding: 14px 16px;
  margin-bottom: 8px;
  position: relative;
}

.card::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 10px;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
  pointer-events: none;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
  font-family: var(--font-sans);
}

.title {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-agent);
  font-family: var(--font-sans);
}

.progress {
  font-size: 11px;
  color: var(--text-muted);
  font-family: var(--font-sans);
}

.stepList {
  margin-top: 8px;
  padding-left: 4px;
}

.step {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 4px 0;
  font-size: 12px;
  font-family: var(--font-sans);
}

.stepOutput {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-muted);
  margin-top: 4px;
  padding-left: 20px;
}
```

- [ ] **Step 2: Update AgentStepCard.tsx**

1. Add import: `import styles from './AgentStepCard.module.css';`
2. Replace inline styles with module classes
3. Add dynamic `boxShadow` on status icons: `0 0 6px rgba(color, 0.4)` based on step state

- [ ] **Step 3: Verify build and tests**

Run: `npm run build && npm test`
Expected: Build succeeds, all tests pass

- [ ] **Step 4: Commit**

```bash
git add src/components/AgentStepCard.module.css src/components/AgentStepCard.tsx
git commit -m "feat: migrate AgentStepCard to CSS modules with card treatment"
```

---

### Task 11: Migrate Remaining Small Components

**Files:**
- Create: `src/components/ErrorAffordance.module.css`
- Create: `src/components/TrustBadge.module.css`
- Modify: `src/components/ErrorAffordance.tsx`
- Modify: `src/components/TrustBadge.tsx`

- [ ] **Step 1: Create ErrorAffordance.module.css**

```css
.container {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 6px;
  background: rgba(139, 92, 246, 0.08);
  border: 1px solid rgba(139, 92, 246, 0.15);
  cursor: pointer;
  transition: background 0.15s;
  font-family: var(--font-sans);
  font-size: 12px;
  color: var(--color-ai);
}

.container:hover {
  background: rgba(139, 92, 246, 0.12);
}

.icon {
  font-size: 14px;
}
```

- [ ] **Step 2: Update ErrorAffordance.tsx**

1. Add import: `import styles from './ErrorAffordance.module.css';`
2. Replace inline styles with module classes

- [ ] **Step 3: Create TrustBadge.module.css**

```css
.badge {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 500;
  font-family: var(--font-sans);
  letter-spacing: 0.3px;
}

.icon {
  font-size: 10px;
}
```

- [ ] **Step 4: Update TrustBadge.tsx**

1. Add import: `import styles from './TrustBadge.module.css';`
2. Replace inline styles, keep dynamic `borderColor` and `color` as inline style (mode-dependent)

- [ ] **Step 5: Verify build and tests**

Run: `npm run build && npm test`
Expected: Build succeeds, all tests pass

- [ ] **Step 6: Commit**

```bash
git add src/components/ErrorAffordance.module.css src/components/ErrorAffordance.tsx src/components/TrustBadge.module.css src/components/TrustBadge.tsx
git commit -m "feat: migrate ErrorAffordance and TrustBadge to CSS modules"
```

---

### Task 12: Migrate Modal Components

**Files:**
- Create: `src/components/SettingsOverlay.module.css`
- Create: `src/components/ConfirmModal.module.css`
- Create: `src/components/WhatsNewModal.module.css`
- Create: `src/components/UpdateNotifier.module.css`
- Modify: `src/components/SettingsOverlay.tsx`
- Modify: `src/components/ConfirmModal.tsx`
- Modify: `src/components/WhatsNewModal.tsx`
- Modify: `src/components/UpdateNotifier.tsx`

- [ ] **Step 1: Read all four components**

Read each file to extract current inline styles.

- [ ] **Step 2: Create SettingsOverlay.module.css**

Extract inline styles from `SettingsOverlay.tsx`. Apply:
- Modal overlay with noise texture (via background-image same SVG as globals)
- Surface uses `var(--bg-card)` background, `var(--border-card)` border
- All text in `var(--font-sans)`
- Keep existing layout structure (sidebar tabs + content area)

- [ ] **Step 3: Update SettingsOverlay.tsx**

1. Add import: `import styles from './SettingsOverlay.module.css';`
2. Replace inline styles with module classes
3. Keep dynamic visibility (`display: none` when not open) as inline

- [ ] **Step 4: Create ConfirmModal.module.css**

Extract inline styles. Apply:
- Overlay with noise texture
- Surface uses `var(--bg-card)`, `var(--border-card)`
- Buttons get elevation: `box-shadow: 0 2px 4px rgba(0,0,0,0.2)`
- All text in `var(--font-sans)`

- [ ] **Step 5: Update ConfirmModal.tsx**

1. Add import: `import styles from './ConfirmModal.module.css';`
2. Replace inline styles with module classes

- [ ] **Step 6: Create WhatsNewModal.module.css**

Extract inline styles and existing `<style>` block. Apply:
- Overlay with noise texture
- Surface uses `var(--bg-card)`, `var(--border-card)`
- All text in `var(--font-sans)` except code blocks
- Keep existing markdown styling rules

- [ ] **Step 7: Update WhatsNewModal.tsx**

1. Remove `<style>` block
2. Add import: `import styles from './WhatsNewModal.module.css';`
3. Replace inline styles and classNames

- [ ] **Step 8: Create UpdateNotifier.module.css**

Extract inline styles and keyframe animation. Apply:
- Toast uses `var(--bg-card)`, `var(--border-card)`
- Text in `var(--font-sans)`

- [ ] **Step 9: Update UpdateNotifier.tsx**

1. Remove inline `<style>` if present
2. Add import: `import styles from './UpdateNotifier.module.css';`
3. Replace inline styles with module classes

- [ ] **Step 10: Verify build and tests**

Run: `npm run build && npm test`
Expected: Build succeeds, all tests pass

- [ ] **Step 11: Commit**

```bash
git add src/components/SettingsOverlay.module.css src/components/SettingsOverlay.tsx \
       src/components/ConfirmModal.module.css src/components/ConfirmModal.tsx \
       src/components/WhatsNewModal.module.css src/components/WhatsNewModal.tsx \
       src/components/UpdateNotifier.module.css src/components/UpdateNotifier.tsx
git commit -m "feat: migrate modal components to CSS modules with noise texture overlays"
```

---

### Task 13: Final Cleanup and Verification

**Files:**
- Modify: `src/styles/globals.css` (remove orphaned keyframes if any)

- [ ] **Step 1: Remove component-specific keyframes from globals.css**

Check `src/styles/globals.css` for any keyframes that were moved to component modules (like `gradient-sweep` if it was there). Remove them if they're now defined in the component modules. Keep shared ones (`fadeIn`, `pulse`, `spin`, `shimmer`).

- [ ] **Step 2: Verify no remaining inline style blocks**

Run: `grep -r "const styles = \`" src/components/` and `grep -r "<style>{" src/components/`
Expected: No matches (all extracted to CSS modules)

- [ ] **Step 3: Verify no references to deleted GradientBorder**

Run: `grep -r "GradientBorder" src/`
Expected: No matches

- [ ] **Step 4: Verify old color values are gone**

Run: `grep -r "#a85ff1\|#d4770c" src/`
Expected: No matches (all updated to new palette)

- [ ] **Step 5: Full build**

Run: `npm run build`
Expected: Successful compilation, no warnings

- [ ] **Step 6: Run full test suite**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 7: Start dev server and visually verify**

Run: `npm run dev`
Verify in browser:
- Top accent line animates with 3-color gradient
- Tab bar has frosted glass effect
- Active tab has glow and mode-colored bottom border
- Command blocks are elevated cards
- Input has premium shadow and rounded gradient border
- Noise texture visible on surfaces
- Geist Sans on all UI chrome, Fira Code in terminal
- Settings/modals have noise texture overlay
- No visual regressions in AI mode, agent mode, error states

- [ ] **Step 8: Commit cleanup**

```bash
git add -A
git commit -m "chore: final cleanup — remove orphaned styles, verify redesign"
```
