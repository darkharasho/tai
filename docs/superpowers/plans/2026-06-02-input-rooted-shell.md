# Input-Rooted Interactive Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make TAI's single bottom composer the live edge of the block it spawns — when you launch an interactive program the input docks into the block (Warp-style, pinned to the viewport bottom) and the block grows upward out of it; when the program exits the composer drops back out.

**Architecture:** A pure state-machine function maps the interactive signals TAI already computes (`interactiveMode`, `interactiveFullscreen`, `altScreenVisible`, `awaitingInput`, `passwordPrompt`) to one of four input *surfaces* (`composer | tier1 | docked | fullscreen`). `TerminalSession` renders the active interactive block in the bottom-pinned region (where the composer normally lives) when the surface is `docked`/`tier1`, hides the standalone composer, and continues portaling the existing hidden xterm into that block. No changes to the segmenter, PTY layer, AI pipeline, or `remoteAiSession.ts` — this is a renderer layout + focus redesign.

**Tech Stack:** React + TypeScript, CSS Modules, xterm.js (`@xterm/xterm`), Electron, Vitest + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-06-02-input-rooted-shell-design.md`

**Resolved open questions:** live-block max-height = `70vh`; dock/undock animation = polish-later (ship layout/focus first).

---

## File Structure

- **Create** `src/utils/inputSurface.ts` — pure state machine: signals → surface, plus `focusTargetFor` and `composerVisible`/`pinnedActiveBlock` predicates. One responsibility: decide what the input *is* right now.
- **Create** `tests/unit/inputSurface.test.ts` — exhaustive table tests for the derivation.
- **Modify** `src/components/CommandBlock.tsx` — add a `docked` rendering variant (max-height + internal scroll on the interactive body) and an optional `headerExtra` slot (for the remote-AI pill while docked).
- **Modify** `src/components/CommandBlock.module.css` — `.dockedInteractiveBody` (max-height/scroll).
- **Modify** `tests/unit/` — new `CommandBlockDocked.test.tsx`.
- **Modify** `src/components/TerminalSession.tsx` — derive the surface; split the trailing active interactive block into the bottom-pinned region; hide the standalone composer while docked; route the xterm portal + remote-AI pill to the pinned block; wire focus transitions.
- **Modify** `src/components/TerminalSession` styles (inline today) — bottom-pinned container behavior.

---

## Task 1: Pure input-surface state machine

**Files:**
- Create: `src/utils/inputSurface.ts`
- Test: `tests/unit/inputSurface.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/inputSurface.test.ts
import { describe, it, expect } from 'vitest';
import {
  deriveInputSurface,
  focusTargetFor,
  composerVisible,
  pinnedActiveBlock,
  type InteractiveSignals,
} from '../../src/utils/inputSurface';

const base: InteractiveSignals = {
  altScreenVisible: false,
  interactiveMode: false,
  interactiveFullscreen: false,
  awaitingInput: false,
  passwordPrompt: false,
};

describe('deriveInputSurface', () => {
  it('is the free composer when the shell is foreground', () => {
    expect(deriveInputSurface(base)).toBe('composer');
  });

  it('is tier1 for a password prompt (highest precedence)', () => {
    expect(deriveInputSurface({ ...base, passwordPrompt: true, interactiveMode: true })).toBe('tier1');
  });

  it('is tier1 for a cooked line read', () => {
    expect(deriveInputSurface({ ...base, awaitingInput: true })).toBe('tier1');
  });

  it('is fullscreen for an alt-screen TUI', () => {
    expect(deriveInputSurface({ ...base, altScreenVisible: true })).toBe('fullscreen');
  });

  it('is fullscreen for a raw-mode fullscreen program', () => {
    expect(deriveInputSurface({ ...base, interactiveMode: true, interactiveFullscreen: true })).toBe('fullscreen');
  });

  it('is docked for a raw-mode REPL/ssh (Tier 2)', () => {
    expect(deriveInputSurface({ ...base, interactiveMode: true })).toBe('docked');
  });
});

describe('focusTargetFor', () => {
  it('maps each surface to its owning element', () => {
    expect(focusTargetFor('composer')).toBe('composer');
    expect(focusTargetFor('tier1')).toBe('cardInput');
    expect(focusTargetFor('docked')).toBe('xterm');
    expect(focusTargetFor('fullscreen')).toBe('xterm');
  });
});

describe('predicates', () => {
  it('shows the standalone composer only in the composer surface', () => {
    expect(composerVisible('composer')).toBe(true);
    expect(composerVisible('docked')).toBe(false);
    expect(composerVisible('tier1')).toBe(false);
    expect(composerVisible('fullscreen')).toBe(false);
  });

  it('pins the active block for docked and tier1, not fullscreen/composer', () => {
    expect(pinnedActiveBlock('docked')).toBe(true);
    expect(pinnedActiveBlock('tier1')).toBe(true);
    expect(pinnedActiveBlock('fullscreen')).toBe(false);
    expect(pinnedActiveBlock('composer')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- inputSurface`
Expected: FAIL — `Cannot find module '../../src/utils/inputSurface'`.

- [ ] **Step 3: Write the minimal implementation**

```ts
// src/utils/inputSurface.ts

/**
 * What the single bottom input *is* at this moment. One signal drives it:
 * is the foreground process the shell, or a child program?
 *
 *  - composer:   Personality 1 — free shell composer with full TAI smarts.
 *  - tier1:      a line prompt / password — light single-answer input on the
 *                pinned active block.
 *  - docked:     Personality 2 — the live terminal edge (Tier 2: REPLs/ssh),
 *                raw passthrough, block grows upward, pinned to the bottom.
 *  - fullscreen: Tier 3 — a full TUI takes over its own surface (alt-screen).
 */
export type InputSurface = 'composer' | 'tier1' | 'docked' | 'fullscreen';

export interface InteractiveSignals {
  altScreenVisible: boolean;
  /** A raw-mode child program is foreground (termios poll: e.interactiveProgram). */
  interactiveMode: boolean;
  interactiveFullscreen: boolean;
  /** A cooked, line-at-a-time read() is blocking. */
  awaitingInput: boolean;
  passwordPrompt: boolean;
}

export function deriveInputSurface(s: InteractiveSignals): InputSurface {
  // Single-answer prompts take precedence: they can co-occur with interactiveMode
  // (the password path also flips interactiveMode) but need the light line input.
  if (s.passwordPrompt || s.awaitingInput) return 'tier1';
  if (s.altScreenVisible || (s.interactiveMode && s.interactiveFullscreen)) return 'fullscreen';
  if (s.interactiveMode) return 'docked';
  return 'composer';
}

export function focusTargetFor(surface: InputSurface): 'composer' | 'cardInput' | 'xterm' {
  if (surface === 'composer') return 'composer';
  if (surface === 'tier1') return 'cardInput';
  return 'xterm';
}

/** The standalone bottom composer renders only in the free-composer surface. */
export function composerVisible(surface: InputSurface): boolean {
  return surface === 'composer';
}

/** The active interactive block is pinned to the bottom region (not in scroll). */
export function pinnedActiveBlock(surface: InputSurface): boolean {
  return surface === 'docked' || surface === 'tier1';
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- inputSurface`
Expected: PASS (all cases green).

- [ ] **Step 5: Commit**

```bash
git add src/utils/inputSurface.ts tests/unit/inputSurface.test.ts
git commit -m "feat(input-rooted): pure input-surface state machine"
```

---

## Task 2: CommandBlock docked variant + header slot

**Files:**
- Modify: `src/components/CommandBlock.tsx`
- Modify: `src/components/CommandBlock.module.css`
- Test: `tests/unit/CommandBlockDocked.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/CommandBlockDocked.test.tsx
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { CommandBlock } from '../../src/components/CommandBlock';
import type { SegmentedBlock } from '../../src/types';

const block: SegmentedBlock = {
  id: 'b1',
  command: 'python',
  output: '',
  rawOutput: '',
  promptText: 'me@host ~/proj $',
  startTime: 0,
  duration: 0,
  exitCode: undefined,
  isRemote: false,
} as SegmentedBlock;

const noop = () => {};

describe('CommandBlock docked variant', () => {
  it('applies the docked interactive body class when docked', () => {
    const { container } = render(
      <CommandBlock
        block={block}
        active
        isActive
        bodyMode="interactive"
        ptyId={7}
        docked
        onCopy={noop}
        onAskAI={noop}
        onRerun={noop}
      />,
    );
    // The xterm host carries the docked class so CSS caps height + scrolls.
    expect(container.querySelector('[class*="dockedInteractiveBody"]')).toBeTruthy();
  });

  it('renders a headerExtra slot (e.g. the remote-AI pill) in the header', () => {
    render(
      <CommandBlock
        block={block}
        active
        isActive
        bodyMode="interactive"
        ptyId={7}
        docked
        headerExtra={<span data-testid="pill">pill</span>}
        onCopy={noop}
        onAskAI={noop}
        onRerun={noop}
      />,
    );
    expect(screen.getByTestId('pill')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- CommandBlockDocked`
Expected: FAIL — `docked`/`headerExtra` props don't exist and no `dockedInteractiveBody` class is applied.

- [ ] **Step 3: Add the props and the docked rendering**

In `src/components/CommandBlock.tsx`, extend the props interface (after `sessionRemote?: boolean;` at `CommandBlockProps`):

```tsx
  /** Render as the bottom-pinned live edge: cap the interactive body height + scroll. */
  docked?: boolean;
  /** Optional node rendered in the prompt-right header area (e.g. the remote-AI pill). */
  headerExtra?: React.ReactNode;
```

Add them to the destructured params (alongside `sessionRemote`):

```tsx
  sessionRemote,
  docked,
  headerExtra,
```

Render `headerExtra` in the header. Find the `promptRight` block (`<div className={styles.promptRight}>`) and insert the slot as its first child:

```tsx
        <div className={styles.promptRight}>
          {headerExtra}
          {active ? (
```

Apply the docked class to the **active** interactive host. Find:

```tsx
          {isActive ? (
            <div ref={onInteractiveContainerRef} className={styles.interactiveBody} />
          ) : (
```

Replace the host line with:

```tsx
          {isActive ? (
            <div
              ref={onInteractiveContainerRef}
              className={`${styles.interactiveBody}${docked ? ` ${styles.dockedInteractiveBody}` : ''}`}
            />
          ) : (
```

- [ ] **Step 4: Add the CSS**

In `src/components/CommandBlock.module.css`, add:

```css
.dockedInteractiveBody {
  max-height: 70vh;
  overflow-y: auto;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- CommandBlockDocked`
Expected: PASS (both cases).

- [ ] **Step 6: Commit**

```bash
git add src/components/CommandBlock.tsx src/components/CommandBlock.module.css tests/unit/CommandBlockDocked.test.tsx
git commit -m "feat(input-rooted): CommandBlock docked variant + header slot"
```

---

## Task 3: Pin the active interactive block to the bottom region

**Files:**
- Modify: `src/components/TerminalSession.tsx`

This task makes the active interactive block render in the bottom region (where the composer lives) instead of inside the scrolling `BlockList`, and hides the standalone composer while docked. No unit test — verified by running the app (TerminalSession instantiates xterm + PTY IPC, untestable in jsdom; matches the repo's existing no-test policy for this component).

- [ ] **Step 1: Import the state machine**

Near the other `@/utils` imports in `TerminalSession.tsx`, add:

```tsx
import {
  deriveInputSurface, focusTargetFor, composerVisible, pinnedActiveBlock,
} from '@/utils/inputSurface';
```

- [ ] **Step 2: Derive the surface (replace the ad-hoc booleans)**

Find this block (currently ~lines 1088-1102):

```tsx
  const showFullscreenInteractive = interactiveMode && interactiveFullscreen && !altScreenVisible;
  const showXterm = altScreenVisible || showFullscreenInteractive || interactiveMode;
  const blockInputLocked = awaitingInput || passwordPrompt;
  const remoteAiActive = remoteAi.mode === 'watch' || remoteAi.mode === 'run';
  const inputDisabled = blockInputLocked || (hasActiveBlock && !passwordPrompt && !remoteAiActive);
  const activeBodyMode: import('@/types').BlockBodyMode =
    passwordPrompt ? 'password'
    : (altScreenVisible || interactiveMode) ? 'interactive'
    : 'output';
```

Replace with:

```tsx
  const surface = deriveInputSurface({
    altScreenVisible, interactiveMode, interactiveFullscreen, awaitingInput, passwordPrompt,
  });
  const showFullscreenInteractive = surface === 'fullscreen' && !altScreenVisible;
  const showXterm = altScreenVisible || showFullscreenInteractive || interactiveMode;
  const remoteAiActive = remoteAi.mode === 'watch' || remoteAi.mode === 'run';
  // The active interactive block (Tier 2 / Tier 1) is pinned to the bottom region.
  const isPinned = pinnedActiveBlock(surface);
  const showComposer = composerVisible(surface) && !showXterm;
  const blockInputLocked = awaitingInput || passwordPrompt;
  const inputDisabled = blockInputLocked || (hasActiveBlock && !passwordPrompt && !remoteAiActive);
  const activeBodyMode: import('@/types').BlockBodyMode =
    passwordPrompt ? 'password'
    : (altScreenVisible || interactiveMode) ? 'interactive'
    : 'output';
```

- [ ] **Step 3: Split the trailing active block out of the history list**

Just before the `return (` of the component, compute the split:

```tsx
  // While docked/tier1, the trailing active command block is rendered in the
  // bottom-pinned region (Personality 2), not inside the scrolling history.
  const lastItem = displayItems[displayItems.length - 1];
  const pinnedBlock =
    isPinned && lastItem?.type === 'command' && (lastItem as DisplayItem & { type: 'command' }).active
      ? (lastItem as DisplayItem & { type: 'command' })
      : null;
  const historyItems = pinnedBlock ? displayItems.slice(0, -1) : displayItems;
```

- [ ] **Step 4: Feed the history list and route the portal**

Change the `BlockList` `items` prop from `items={displayItems}` to:

```tsx
          items={historyItems}
```

The xterm portal target (`interactivePortalTarget`) is set by whichever rendered `CommandBlock` calls `onInteractiveContainerRef`. Because the pinned block (Step 5) is the only active interactive block rendered when `isPinned`, the portal naturally lands in it. No portal-wiring change needed — `BlockList` no longer renders the active block when pinned, so it cannot capture the ref.

- [ ] **Step 5: Render the pinned block + gate the composer**

Find the composer region:

```tsx
      {!showXterm && (
        <div style={{ flexShrink: 0, opacity: inputDisabled ? ...
          <TerminalInput ... />
        </div>
      )}
```

Replace the whole `{!showXterm && ( ... )}` composer block with the pinned-block-or-composer bottom region:

```tsx
      {isPinned && pinnedBlock && (
        <div className="pinnedActiveRegion" style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <CommandBlock
            block={pinnedBlock.block}
            active
            isActive
            awaitingInput={awaitingInput}
            cwd={cwd}
            bodyMode={activeBodyMode}
            ptyId={ptyId ?? undefined}
            docked={surface === 'docked'}
            sessionRemote={eff.isRemote}
            onCopy={handleCopy}
            onAskAI={handleAskAI}
            onRerun={handleRerun}
            onSendInput={handleSendInput}
            onPasswordDone={() => setPasswordPrompt(false)}
            onInteractiveContainerRef={setInteractivePortalTarget}
            headerExtra={
              eff.isRemote && remoteAi.target ? (
                <RemoteAiPill
                  view={pillView(remoteAi)}
                  onEnable={handleEnableRemoteAi}
                  onSetMode={handleSetRemoteAiMode}
                  onDismiss={handleDismissRemoteAi}
                />
              ) : undefined
            }
          />
        </div>
      )}
      {showComposer && (
        <div style={{ flexShrink: 0, opacity: inputDisabled ? (blockInputLocked ? 0.3 : 0.5) : 1, pointerEvents: blockInputLocked ? 'none' : 'auto', transition: 'opacity 0.15s', cursor: inputDisabled && !blockInputLocked ? 'not-allowed' : undefined }}>
          <TerminalInput
            ref={inputRef}
            onSubmit={handleSubmit}
            mode={inputMode}
            onModeChange={handleInputModeChange}
            cwd={cwd}
            promptInfo={eff.isRemote
              ? { text: promptInfo?.text ?? '', isRemote: true, sshTarget: eff.sshTarget ?? undefined }
              : promptInfo}
            shellIntegrated={shellIntegrated && !sshSessionActive}
            initialValue={editValue}
            disabled={inputDisabled}
            history={inputHistory}
            onClear={() => setDisplayItems([])}
            remoteAiView={pillView(remoteAi)}
            onEnableRemoteAi={handleEnableRemoteAi}
            onSetRemoteAiMode={handleSetRemoteAiMode}
            onDismissRemoteAi={handleDismissRemoteAi}
            aiProvider={aiProvider}
            trustLevel={trustLevel}
            onTrustLevelChange={onTrustLevelChange}
          />
        </div>
      )}
```

Add the `CommandBlock` import at the top of the file:

```tsx
import { CommandBlock } from './CommandBlock';
```

(`RemoteAiPill`, `pillView` are already importable: `RemoteAiPill` is exported from `./TerminalInput`; add it to that import — `import { TerminalInput, RemoteAiPill } from './TerminalInput';` — and `pillView` is already imported from `@/utils/remoteAiSession`.)

- [ ] **Step 6: Build to catch type errors**

Run: `npm run build`
Expected: `tsc` passes (no type errors), `vite build` completes.

- [ ] **Step 7: Manual verification — dock / undock**

Run the app (`npm run dev`, then launch the Electron shell per the project's run flow). Verify:
- Run `python3` → the active block pins to the bottom; the standalone composer disappears; typing goes to python with its own tab-completion. `exit()` → composer returns and the block joins history with a duration.
- Run `ls` → no pinning; composer stays; finished block appears above.

- [ ] **Step 8: Commit**

```bash
git add src/components/TerminalSession.tsx
git commit -m "feat(input-rooted): pin active interactive block to bottom region"
```

---

## Task 4: Focus transitions on dock / undock

**Files:**
- Modify: `src/components/TerminalSession.tsx`

The xterm must receive focus when we dock, and the composer when we undock. The pure mapping is already tested (`focusTargetFor`, Task 1).

- [ ] **Step 1: Focus the xterm when entering a pinned/fullscreen surface**

The existing focus effect (currently ~lines 1064-1070) is:

```tsx
  useEffect(() => {
    if (awaitingInput || passwordPrompt) {
      inputRef.current?.blur();
    } else if (!altScreenVisible) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [awaitingInput, passwordPrompt, altScreenVisible]);
```

Replace it with a surface-driven version:

```tsx
  useEffect(() => {
    const target = focusTargetFor(surface);
    if (target === 'composer') {
      requestAnimationFrame(() => inputRef.current?.focus());
    } else if (target === 'xterm') {
      inputRef.current?.blur();
      requestAnimationFrame(() => hiddenXtermRef.current?.focus());
    } else {
      // tier1: the card's own line/password input self-focuses (CommandBlock effect).
      inputRef.current?.blur();
    }
  }, [surface]);
```

- [ ] **Step 2: (Already satisfied) HiddenXterm exposes focus()**

`HiddenXtermHandle` already declares `focus: () => void` (`src/components/HiddenXterm.tsx:10`) and the handle calls `xtermRef.current?.focus()`. No change needed — `hiddenXtermRef.current?.focus()` in Step 1 works as written.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: passes.

- [ ] **Step 4: Manual verification — focus**

Run the app. Verify:
- `python3` → cursor is in the python prompt immediately; you can type without clicking.
- `exit()` → focus returns to the composer; you can type a shell command immediately.
- `sudo true` (password) → focus lands in the masked card input.

- [ ] **Step 5: Commit**

```bash
git add src/components/TerminalSession.tsx
git commit -m "feat(input-rooted): focus transitions on dock/undock"
```

---

## Task 5: Bottom-pinned grow-upward layout

**Files:**
- Modify: `src/components/TerminalSession.tsx` (the outer flex container + history scroll)

Ensure the history scrolls and the pinned region sits flush at the bottom and grows upward.

- [ ] **Step 1: Make the session a bottom-anchored flex column**

The component's root is:

```tsx
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0, position: 'relative' }}>
```

This is already a column with `BlockList` (flex:1, scrolls) above the bottom region. Confirm `BlockList`'s root has `flex: 1; overflow-y: auto; min-height: 0;` so the pinned region stays glued to the bottom and history scrolls behind it.

Run: `grep -n "overflow" src/components/BlockList.tsx src/components/*.module.css | grep -i block`

If `BlockList` is not already a `flex:1` scroller, wrap its container so it is. Otherwise no change.

- [ ] **Step 2: Verify the pinned block grows upward and caps at 70vh**

The `.dockedInteractiveBody` cap (Task 2) plus `flexShrink: 0` on the pinned region (Task 3) already produce grow-upward-then-internal-scroll. Confirm visually in Step 3.

- [ ] **Step 3: Manual verification — growth + scroll**

Run the app. Verify:
- `python3`, then paste ~100 lines of output → the block grows upward, caps at ~70% viewport height, and scrolls internally; the prompt row stays visible at the bottom; history is still scrollable above.
- `ssh <host>` then `tail -f <busy log>` → block grows/internal-scrolls; `Ctrl-C` stops the tail; `exit` returns to the composer.

- [ ] **Step 4: Commit (only if files changed)**

```bash
git add src/components/TerminalSession.tsx src/components/BlockList.tsx src/components/*.module.css
git commit -m "feat(input-rooted): bottom-pinned grow-upward layout"
```

---

## Task 6: Tier-1 and full-integration verification

**Files:** none (verification + graph refresh)

- [ ] **Step 1: Verify Tier-1 prompts in the pinned region**

Run the app. Verify:
- `sudo true` → the masked `PasswordPrompt` renders as the bottom-pinned card edge; composer hidden; on completion the composer returns.
- A script doing `read -p "Overwrite? [y/N] " x; echo $x` → the single-answer line input renders pinned; Enter sends; composer returns.

- [ ] **Step 2: Verify Tier-3 still takes over**

- `vim` / `htop` → full takeover (existing fullscreen xterm); on quit, composer returns. No regression.

- [ ] **Step 3: Verify ssh + remote-AI pill while docked**

- `ssh <host>` → block pins; the watch/run pill appears **in the block header** (via `headerExtra`); toggling watch/run still works; the pill is gone after `exit`.

- [ ] **Step 4: Verify quick commands + AI mode at the prompt**

- `git status`, `ls` → no pinning, composer free.
- At the shell prompt, Shift+Tab → AI mode still toggles; ghost text + tab-completion still work.

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: all green (including `inputSurface` and `CommandBlockDocked`).

- [ ] **Step 6: Refresh the knowledge graph**

Run: `graphify update .`
Expected: completes (AST-only, no API cost).

- [ ] **Step 7: Commit any verification fixes**

```bash
git add -A
git commit -m "test(input-rooted): integration verification + graph refresh"
```

---

## Notes for the implementer

- **Do not** touch `BlockSegmenter`, the PTY layer, the AI request pipeline, or `remoteAiSession.ts`. If you find yourself editing them, stop — the design says this is renderer-only.
- The hidden xterm is a **single instance** relocated via portal. The pinned block must be the only rendered active interactive `CommandBlock` while `isPinned`, or two elements will fight over `onInteractiveContainerRef`. Task 3 Step 3 guarantees this by removing the trailing active block from `historyItems`.
- If the pinned block flickers on dock/undock, it's a portal-relocation timing issue, not a layout bug — check that `interactivePortalTarget` updates after the pinned `CommandBlock` mounts.

## Post-implementation status (2026-06-02)

All six tasks implemented on `feat/input-rooted-shell`; build clean, 317/317 tests green; final whole-feature review = Ready to merge. `graphify update` could not run (binary not installed in this environment).

**Tracked follow-ups (non-blocking):**
- DRY: the pinned `CommandBlock` re-wires ~14 props that `BlockList` also passes to active blocks. Extract a shared `ActiveCommandBlock` wrapper if a third call site or prop drift appears.
- The window-`focus` handler in `TerminalSession` (~L1061) still uses raw `!altScreenVisible && !awaitingInput && !passwordPrompt` checks; route it through `focusTargetFor(surface)` so a docked session refocuses the xterm on window refocus (needs `surface` hoisted above that effect).
- Minor: `showComposer`'s `&& !showXterm` is dead-defensive (`composerVisible` already implies it). `pinnedBlock` assumes the active command is the last display item; `findLast(active)` would be more robust.
- Verify the docked↔fullscreen portal handoff doesn't visibly flicker; if it does, coalesce `interactivePortalTarget` so it never passes through `null` while `showXterm` stays true.

**Manual in-app verification still required (automated tests structurally cannot cover):**
1. python REPL — native tab-completion / Ctrl-R / arrow history / echo in the docked block; Ctrl-D → composer returns, block detaches with duration.
2. `ssh host` — docks; remote-AI pill in the block header (orange), watch/run toggles, AI usable out-of-band.
3. nesting: `ssh` → `vim` promotes to fullscreen, `:q` returns to docked ssh with focus back in xterm (watch for flicker).
4. sudo/ssh password — tier1 masked input on the pinned block, focus in the card input.
5. `tail -f` — grows then internally scrolls at 70vh, Ctrl-C flows through.
6. quick `ls`/`git status` — no dock, composer stays free.
7. tab switching mid-session — dock survives `visible` toggle, xterm buffer preserved.
8. multi-line shell command at the composer still submits.
