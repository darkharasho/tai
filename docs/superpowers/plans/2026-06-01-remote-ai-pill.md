# Remote-AI Pill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bridge interactive-ssh detection to the AI side with a subtle inline composer pill offering watch (local AI + remote context) and run (AI tools execute on the host) modes.

**Architecture:** A pure state machine (`remoteAiSession.ts`) holds the per-tab remote-AI state and derives the pill's view; `TerminalInput` renders the pill and emits intents; `TerminalSession` owns the state, subscribes to `onSshSession`, maps modes onto the existing `setRemoteTarget`/daemon path, and injects redacted remote scrollback in watch mode. Watch needs no helper; the one-time daemon install is deferred to the first switch to run.

**Tech Stack:** TypeScript, React, vitest (node + per-file jsdom via `@vitest-environment`), @testing-library/react, existing tai-daemon IPC.

**Spec:** `docs/superpowers/specs/2026-06-01-remote-ai-pill-design.md`

---

## File structure

- Create: `src/utils/remoteAiSession.ts` — pure state machine + `pillView` (one responsibility: remote-AI state). Absorbs `remoteOverride.ts`.
- Create: `tests/unit/remoteAiSession.test.ts`
- Create: `tests/unit/TerminalInputPill.test.tsx` — RTL render test for the pill.
- Modify: `src/components/TerminalInput.tsx` — replace the `⥂` control with the pill.
- Modify: `src/components/TerminalInput.module.css` — pill styles (replace `markRemote*`).
- Modify: `src/components/TerminalSession.tsx` — own state, wire `onSshSession`, handlers, mode→exec mapping, watch context, composer-lock change.
- Delete: `src/utils/remoteOverride.ts`, `tests/unit/remoteOverride.test.ts` (folded into `remoteAiSession`).

---

## Task 1: Remote-AI state machine

**Files:**
- Create: `src/utils/remoteAiSession.ts`
- Test: `tests/unit/remoteAiSession.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/remoteAiSession.test.ts
import { describe, it, expect } from 'vitest';
import {
  initialRemoteAi, pillView, onSshChange, enableWatch, setMode,
  setInstalling, setHelperInstalled, dismissOffer, setError,
} from '../../src/utils/remoteAiSession';

describe('remoteAiSession', () => {
  it('starts hidden with no ssh', () => {
    expect(pillView(initialRemoteAi())).toEqual({ kind: 'hidden' });
  });

  it('shows the offer when an ssh session becomes active', () => {
    const s = onSshChange(initialRemoteAi(), true, 'piclock');
    expect(pillView(s)).toEqual({ kind: 'offer', target: 'piclock' });
  });

  it('enable goes straight to active/watch (no helper needed)', () => {
    const s = enableWatch(onSshChange(initialRemoteAi(), true, 'piclock'));
    expect(s.mode).toBe('watch');
    expect(pillView(s)).toEqual({ kind: 'active', target: 'piclock', mode: 'watch', error: null });
  });

  it('shows installing while a run-install is in flight', () => {
    let s = enableWatch(onSshChange(initialRemoteAi(), true, 'piclock'));
    s = setInstalling(s, true);
    expect(pillView(s)).toEqual({ kind: 'installing', target: 'piclock' });
  });

  it('switches to run once the helper is installed', () => {
    let s = enableWatch(onSshChange(initialRemoteAi(), true, 'piclock'));
    s = setHelperInstalled(setInstalling(s, false), true);
    s = setMode(s, 'run');
    expect(pillView(s)).toEqual({ kind: 'active', target: 'piclock', mode: 'run', error: null });
  });

  it('clears everything when the ssh session ends', () => {
    let s = enableWatch(onSshChange(initialRemoteAi(), true, 'piclock'));
    s = onSshChange(s, false, null);
    expect(pillView(s)).toEqual({ kind: 'hidden' });
    expect(s.mode).toBe('off');
  });

  it('hides the offer after dismissal but keeps ssh state', () => {
    let s = onSshChange(initialRemoteAi(), true, 'piclock');
    s = dismissOffer(s);
    expect(pillView(s)).toEqual({ kind: 'hidden' });
    expect(s.sshActive).toBe(true);
  });

  it('restores remembered mode/helper when re-entering a known host', () => {
    const s = onSshChange(initialRemoteAi(), true, 'piclock',
      { mode: 'run', helperInstalled: true, dismissed: false });
    expect(pillView(s)).toEqual({ kind: 'active', target: 'piclock', mode: 'run', error: null });
  });

  it('records an error and falls back to watch', () => {
    let s = enableWatch(onSshChange(initialRemoteAi(), true, 'piclock'));
    s = setError(setInstalling(s, false), 'install failed');
    expect(pillView(s)).toEqual({ kind: 'active', target: 'piclock', mode: 'watch', error: 'install failed' });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --config tests/vitest.config.ts tests/unit/remoteAiSession.test.ts`
Expected: FAIL — `Cannot find module '../../src/utils/remoteAiSession'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/utils/remoteAiSession.ts
// Per-tab remote-AI state for the interactive-ssh "AI on this host" pill.
// Pure + fully testable; TerminalSession owns one instance and orchestrates the
// async install. Watch needs no helper (local execution + remote context); the
// daemon install is deferred to the first switch to run.

export type RemoteAiMode = 'off' | 'watch' | 'run';

export interface RemoteAiState {
  sshActive: boolean;
  target: string | null;
  mode: RemoteAiMode;
  installing: boolean;
  helperInstalled: boolean;
  dismissed: boolean;
  error: string | null;
}

export interface RememberedHost {
  mode: RemoteAiMode;
  helperInstalled: boolean;
  dismissed: boolean;
}

export type PillView =
  | { kind: 'hidden' }
  | { kind: 'offer'; target: string }
  | { kind: 'installing'; target: string }
  | { kind: 'active'; target: string; mode: 'watch' | 'run'; error: string | null };

export function initialRemoteAi(): RemoteAiState {
  return {
    sshActive: false,
    target: null,
    mode: 'off',
    installing: false,
    helperInstalled: false,
    dismissed: false,
    error: null,
  };
}

export function pillView(s: RemoteAiState): PillView {
  if (!s.sshActive || !s.target) return { kind: 'hidden' };
  if (s.installing) return { kind: 'installing', target: s.target };
  if (s.mode === 'watch' || s.mode === 'run') {
    return { kind: 'active', target: s.target, mode: s.mode, error: s.error };
  }
  if (s.dismissed) return { kind: 'hidden' };
  return { kind: 'offer', target: s.target };
}

export function onSshChange(
  s: RemoteAiState,
  active: boolean,
  target: string | null,
  remembered?: RememberedHost,
): RemoteAiState {
  if (!active || !target) return initialRemoteAi();
  return {
    ...initialRemoteAi(),
    sshActive: true,
    target,
    mode: remembered?.mode ?? 'off',
    helperInstalled: remembered?.helperInstalled ?? false,
    dismissed: remembered?.dismissed ?? false,
  };
}

export function enableWatch(s: RemoteAiState): RemoteAiState {
  return { ...s, mode: 'watch', dismissed: false, error: null };
}

export function setMode(s: RemoteAiState, mode: RemoteAiMode): RemoteAiState {
  return { ...s, mode, error: null };
}

export function setInstalling(s: RemoteAiState, installing: boolean): RemoteAiState {
  return { ...s, installing };
}

export function setHelperInstalled(s: RemoteAiState, ok: boolean): RemoteAiState {
  return { ...s, helperInstalled: ok };
}

export function dismissOffer(s: RemoteAiState): RemoteAiState {
  return { ...s, dismissed: true };
}

export function setError(s: RemoteAiState, error: string | null): RemoteAiState {
  // An error only surfaces in the active view; ensure we are at least in watch.
  return { ...s, error, installing: false, mode: s.mode === 'off' ? 'watch' : s.mode };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --config tests/vitest.config.ts tests/unit/remoteAiSession.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/utils/remoteAiSession.ts tests/unit/remoteAiSession.test.ts
git commit -m "feat(remote-ai): pure state machine + pill view for ssh AI pill"
```

---

## Task 2: Pill component in TerminalInput

**Files:**
- Modify: `src/components/TerminalInput.tsx` (the block added at ~line 321 for `onSetManualRemote`, and props)
- Modify: `src/components/TerminalInput.module.css` (replace `markRemote*` classes)
- Test: `tests/unit/TerminalInputPill.test.tsx`

- [ ] **Step 1: Write the failing component test**

```tsx
// tests/unit/TerminalInputPill.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RemoteAiPill } from '../../src/components/TerminalInput';

describe('RemoteAiPill', () => {
  it('renders nothing when hidden', () => {
    const { container } = render(
      <RemoteAiPill view={{ kind: 'hidden' }} onEnable={() => {}} onSetMode={() => {}} onDismiss={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the offer and fires onEnable', () => {
    const onEnable = vi.fn();
    render(<RemoteAiPill view={{ kind: 'offer', target: 'piclock' }} onEnable={onEnable} onSetMode={() => {}} onDismiss={() => {}} />);
    expect(screen.getByText(/piclock/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /enable/i }));
    expect(onEnable).toHaveBeenCalled();
  });

  it('renders the watch/run toggle and switches mode', () => {
    const onSetMode = vi.fn();
    render(<RemoteAiPill view={{ kind: 'active', target: 'piclock', mode: 'watch', error: null }} onEnable={() => {}} onSetMode={onSetMode} onDismiss={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /run/i }));
    expect(onSetMode).toHaveBeenCalledWith('run');
  });

  it('shows an installing state', () => {
    render(<RemoteAiPill view={{ kind: 'installing', target: 'piclock' }} onEnable={() => {}} onSetMode={() => {}} onDismiss={() => {}} />);
    expect(screen.getByText(/installing/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --config tests/vitest.config.ts tests/unit/TerminalInputPill.test.tsx`
Expected: FAIL — `RemoteAiPill` is not exported.

- [ ] **Step 3: Add the `RemoteAiPill` export and its styles**

In `src/components/TerminalInput.tsx`, add the import and the component (above the `TerminalInput` definition):

```tsx
import type { PillView, RemoteAiMode } from '@/utils/remoteAiSession';

export function RemoteAiPill({
  view, onEnable, onSetMode, onDismiss,
}: {
  view: PillView;
  onEnable: () => void;
  onSetMode: (mode: RemoteAiMode) => void;
  onDismiss: () => void;
}) {
  if (view.kind === 'hidden') return null;
  if (view.kind === 'offer') {
    return (
      <span className={styles.raiOffer}>
        <span className={styles.raiSpark}>✦</span> AI · {view.target}
        <button className={styles.raiAction} onClick={(e) => { e.stopPropagation(); onEnable(); }}>enable</button>
        <button className={styles.raiX} title="Dismiss" onClick={(e) => { e.stopPropagation(); onDismiss(); }}>✕</button>
      </span>
    );
  }
  if (view.kind === 'installing') {
    return <span className={styles.raiActive}>⟳ installing on {view.target}…</span>;
  }
  // active
  return (
    <span className={styles.raiActive} title={view.error ?? undefined}>
      <span className={styles.raiSeg}>
        <button
          className={`${styles.raiSegBtn} ${view.mode === 'watch' ? styles.raiWatchOn : ''}`}
          onClick={(e) => { e.stopPropagation(); onSetMode('watch'); }}
        >👁 watch</button>
        <button
          className={`${styles.raiSegBtn} ${view.mode === 'run' ? styles.raiRunOn : ''}`}
          onClick={(e) => { e.stopPropagation(); onSetMode('run'); }}
        >▸ run</button>
      </span>
      <span className={styles.raiHost}>{view.target}</span>
      {view.error && <span className={styles.raiErr} title={view.error}>!</span>}
    </span>
  );
}
```

In `src/components/TerminalInput.module.css`, **remove** the `.markRemoteBtn`, `.markRemoteChip`, `.markRemoteInput` rules added earlier and add:

```css
.raiOffer {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 2px 9px; border: 1px solid rgba(255, 160, 60, 0.35);
  border-radius: 999px; color: var(--color-agent, #ffa03c);
  background: rgba(255, 160, 60, 0.06); font-size: 10.5px;
}
.raiSpark { color: #a78bfa; }
.raiAction {
  background: none; border: none; color: var(--color-agent, #ffa03c);
  font: inherit; font-size: 10.5px; cursor: pointer; text-decoration: underline;
}
.raiX { background: none; border: none; color: #5b6673; cursor: pointer; font-size: 10px; }
.raiActive {
  display: inline-flex; align-items: center; gap: 7px;
  font-size: 10.5px; color: #43c9b0;
}
.raiSeg { display: inline-flex; border: 1px solid #2a3340; border-radius: 999px; overflow: hidden; }
.raiSegBtn {
  background: none; border: none; color: #5b6673; font: inherit; font-size: 10px;
  padding: 2px 9px; cursor: pointer;
}
.raiWatchOn { background: rgba(67, 201, 176, 0.16); color: #43c9b0; }
.raiRunOn { background: rgba(255, 160, 60, 0.18); color: var(--color-agent, #ffa03c); }
.raiHost { color: #43c9b0; font-size: 10px; }
.raiErr { color: #f87171; cursor: help; }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run --config tests/vitest.config.ts tests/unit/TerminalInputPill.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/TerminalInput.tsx src/components/TerminalInput.module.css tests/unit/TerminalInputPill.test.tsx
git commit -m "feat(remote-ai): RemoteAiPill component (offer/installing/watch-run)"
```

---

## Task 3: Replace the `⥂` control with the pill in TerminalInput

**Files:**
- Modify: `src/components/TerminalInput.tsx` (props block ~line 62-67, destructure ~line 71, the `onSetManualRemote` JSX block ~line 321-361)

- [ ] **Step 1: Swap the props**

In the `TerminalInputProps` interface, **remove**:

```tsx
  /** Manual remote-host override (null when autodetection governs). */
  manualRemote?: string | null;
  /** Set/clear the manual remote override (host string, or null to clear). */
  onSetManualRemote?: (host: string | null) => void;
```

and **add**:

```tsx
  remoteAiView?: import('@/utils/remoteAiSession').PillView;
  onEnableRemoteAi?: () => void;
  onSetRemoteAiMode?: (mode: import('@/utils/remoteAiSession').RemoteAiMode) => void;
  onDismissRemoteAi?: () => void;
```

- [ ] **Step 2: Update the destructure and remove the marking state**

Change the destructure line to drop `manualRemote, onSetManualRemote` and add the four new props. **Remove** the two `useState` lines `markingRemote`/`markValue` added earlier.

- [ ] **Step 3: Replace the `⥂` JSX block**

Replace the entire `{onSetManualRemote && ( … )}` block (the inline input / chip / `⥂` button) with:

```tsx
          {remoteAiView && onEnableRemoteAi && onSetRemoteAiMode && onDismissRemoteAi && (
            <RemoteAiPill
              view={remoteAiView}
              onEnable={onEnableRemoteAi}
              onSetMode={onSetRemoteAiMode}
              onDismiss={onDismissRemoteAi}
            />
          )}
```

- [ ] **Step 4: Run the existing TerminalInput-adjacent tests + typecheck**

Run: `npx vitest run --config tests/vitest.config.ts tests/unit/TerminalInputPill.test.tsx && npx tsc --noEmit`
Expected: PASS; tsc clean (TerminalSession will be updated in Task 4 — if tsc reports the removed props there, proceed to Task 4 before re-running).

- [ ] **Step 5: Commit**

```bash
git add src/components/TerminalInput.tsx
git commit -m "feat(remote-ai): render RemoteAiPill in the composer, drop manual-mark control"
```

---

## Task 4: Wire state + handlers in TerminalSession

**Files:**
- Modify: `src/components/TerminalSession.tsx` (imports; state near ~line 75; `onSshSession` subscription ~line 397; `eff` derivation ~line 187; the `<TerminalInput>` props ~line 1088)

- [ ] **Step 1: Imports and state**

Replace the `import { resolveEffectiveRemote } from '@/utils/remoteOverride';` line with:

```tsx
import {
  initialRemoteAi, pillView, onSshChange, enableWatch, setMode,
  setInstalling, setHelperInstalled, dismissOffer, setError,
  type RemoteAiMode, type RememberedHost,
} from '@/utils/remoteAiSession';
```

Replace the `manualRemote` state line with:

```tsx
  const [remoteAi, setRemoteAi] = useState(initialRemoteAi);
  // Per-host memory so re-entering a known host restores its mode without re-asking.
  const remoteAiMemory = useRef<Map<string, RememberedHost>>(new Map());
```

- [ ] **Step 2: Drive state from `onSshSession`**

In the `segmenter.onSshSession((active, target) => { … })` callback (currently sets `sshSessionActive`/`sshSessionTarget`), append:

```tsx
      setRemoteAi(prev => onSshChange(
        prev, active, target,
        active && target ? remoteAiMemory.current.get(target) : undefined,
      ));
```

- [ ] **Step 3: Replace `eff` with the pill-derived remote target**

Replace the `resolveEffectiveRemote(...)` derivation with:

```tsx
  // Effective remote target for AI: driven by the remote-AI pill.
  const eff = {
    isRemote: remoteAi.mode === 'watch' || remoteAi.mode === 'run',
    sshTarget: remoteAi.target,
    // Only "run" routes tool execution to the host; "watch" keeps exec local.
    exec: remoteAi.mode === 'run' ? ('auto' as const) : ('local' as const),
  };
```

Then change the `setRemoteTarget` effect to use `eff.exec` instead of `remoteExecMode`:

```tsx
  useEffect(() => {
    const target = eff.isRemote ? eff.sshTarget : null;
    window.tai?.ai?.setRemoteTarget(tabId, target, eff.exec);
  }, [tabId, eff.isRemote, eff.sshTarget, eff.exec]);
```

(The `isRemoteExec` in `handleAIRequest` should read `eff.exec === 'auto'`; update that line from `eff.isRemote && remoteExecMode === 'auto'` to `eff.isRemote && eff.exec === 'auto'`.)

- [ ] **Step 4: Handlers (enable / set-mode with deferred install / dismiss)**

Add inside the component:

```tsx
  const rememberRemoteAi = useCallback((s: typeof remoteAi) => {
    if (s.target) {
      remoteAiMemory.current.set(s.target, {
        mode: s.mode === 'off' ? 'off' : s.mode,
        helperInstalled: s.helperInstalled,
        dismissed: s.dismissed,
      });
    }
  }, []);

  const handleEnableRemoteAi = useCallback(() => {
    setRemoteAi(prev => { const next = enableWatch(prev); rememberRemoteAi(next); return next; });
  }, [rememberRemoteAi]);

  const handleDismissRemoteAi = useCallback(() => {
    setRemoteAi(prev => { const next = dismissOffer(prev); rememberRemoteAi(next); return next; });
  }, [rememberRemoteAi]);

  const handleSetRemoteAiMode = useCallback(async (mode: RemoteAiMode) => {
    if (mode !== 'run') {
      setRemoteAi(prev => { const next = setMode(prev, mode); rememberRemoteAi(next); return next; });
      return;
    }
    // run: ensure the daemon helper is present first.
    let target: string | null = null;
    setRemoteAi(prev => { target = prev.target; return prev.helperInstalled ? prev : setInstalling(prev, true); });
    if (!target) return;
    try {
      const res = await window.tai.daemon.check(target);
      if (!res.installed) {
        const r = await window.tai.daemon.install(target);
        if (!r?.ok) throw new Error(r?.error || 'daemon install failed');
      }
      await window.tai.ai.setDaemonEnabled(tabId, true);
      setRemoteAi(prev => {
        const next = setMode(setHelperInstalled(setInstalling(prev, false), true), 'run');
        rememberRemoteAi(next); return next;
      });
    } catch (e: any) {
      setRemoteAi(prev => { const next = setError(setInstalling(prev, false), String(e?.message || e)); rememberRemoteAi(next); return next; });
    }
  }, [tabId, rememberRemoteAi]);
```

> IPC confirmed in `electron/preload.ts`: `window.tai.daemon.check(target)` → `{ installed, version? }`, `window.tai.daemon.install(target)` → `{ ok, error? }`, `window.tai.ai.setDaemonEnabled(key, enabled)`.

- [ ] **Step 5: Pass pill props to `<TerminalInput>`**

Replace the `manualRemote`/`onSetManualRemote` props on `<TerminalInput>` with:

```tsx
            remoteAiView={pillView(remoteAi)}
            onEnableRemoteAi={handleEnableRemoteAi}
            onSetRemoteAiMode={handleSetRemoteAiMode}
            onDismissRemoteAi={handleDismissRemoteAi}
```

Keep passing the synthesized remote `promptInfo` (the `eff.isRemote ? {…} : promptInfo` expression) as-is.

- [ ] **Step 6: Typecheck + full suite**

Run: `npx tsc --noEmit && npx vitest run --config tests/vitest.config.ts`
Expected: tsc clean; all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/components/TerminalSession.tsx
git commit -m "feat(remote-ai): drive the pill from onSshSession; map watch/run to exec"
```

---

## Task 5: Watch-mode remote context

**Files:**
- Modify: `src/components/TerminalSession.tsx` (the per-turn system block assembly in `handleAIRequest`, near the existing `REMOTE EXECUTION` lines ~line 585)

- [ ] **Step 1: Add the watch-context lines**

In `handleAIRequest`, after the existing `isRemoteExec` (run) block, add a watch branch:

```tsx
      // Watch mode: AI runs locally but should see the remote session.
      if (eff.isRemote && eff.exec === 'local' && eff.sshTarget) {
        const remoteOut = displayItems
          .filter((it): it is typeof it & { type: 'command' } => it.type === 'command' && !!it.block.isRemote)
          .slice(-5)
          .map(it => `$ ${it.block.command}\n${(it.block.output || '').trim()}`.trim())
          .join('\n\n');
        if (remoteOut.trim()) {
          lines.push(
            '',
            `REMOTE SESSION (observe-only): the user is in an ssh session on ${eff.sshTarget}.`,
            'Recent remote activity follows. Your tools still run locally; help by reading this context.',
            redactSecrets(remoteOut),
          );
        }
      }
```

(`redactSecrets` is already imported in this file from Task: secret redaction.)

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Manual verification**

Start the app (`npm run dev` or the project's run flow). SSH to a host, click `enable` on the pill, leave it on `watch`, run a couple of commands in the remote shell, then ask the AI a question referencing them. Confirm the AI's answer reflects the remote output. (No automated test — this is integration glue; the redaction + selection logic it depends on are unit-tested elsewhere.)

- [ ] **Step 4: Commit**

```bash
git add src/components/TerminalSession.tsx
git commit -m "feat(remote-ai): inject redacted remote scrollback in watch mode"
```

---

## Task 6: Keep AI input live while a foreground command runs

**Files:**
- Modify: `src/components/TerminalSession.tsx` (`inputDisabled` derivation ~line 1008)

- [ ] **Step 1: Relax the lock for AI input when remote-AI is active**

The composer is disabled while a foreground command runs. AI is out-of-band from the PTY, so when remote-AI is active the AI composer must stay usable. Change the `inputDisabled` derivation so it does not block when remote-AI is active and the user is in AI mode. Current:

```tsx
  const inputDisabled = blockInputLocked || (hasActiveBlock && !passwordPrompt);
```

Replace with:

```tsx
  // When remote-AI is active, keep the composer usable during a foreground
  // command (e.g. the interactive ssh) — AI input is out-of-band from the PTY.
  // Shell submits still queue (handled in onSubmit); password/awaiting locks stay.
  const remoteAiActive = remoteAi.mode === 'watch' || remoteAi.mode === 'run';
  const inputDisabled = blockInputLocked || (hasActiveBlock && !passwordPrompt && !remoteAiActive);
```

- [ ] **Step 2: Verify shell submits still queue**

Inspect the `onSubmit` / submit path the composer uses (search `markCommandSent` / the AI-vs-shell branch in this file). Confirm that when the input mode is **shell** and a command is active, the submit still queues rather than writing to the PTY immediately. If the existing queueing keyed off `inputDisabled`, add an explicit guard so shell submits during an active block still queue while AI submits send. Show the guard inline where the submit branches on mode.

- [ ] **Step 3: Typecheck + full suite**

Run: `npx tsc --noEmit && npx vitest run --config tests/vitest.config.ts`
Expected: tsc clean; all tests pass.

- [ ] **Step 4: Manual verification**

SSH into a host, enable the pill. While the interactive ssh is still the foreground command, press `Shift+Tab` to AI mode and send a prompt — confirm it sends immediately (not queued). Switch back to shell mode and confirm a typed command still queues until the ssh exits.

- [ ] **Step 5: Commit**

```bash
git add src/components/TerminalSession.tsx
git commit -m "feat(remote-ai): keep AI input live during a foreground command"
```

---

## Task 7: Remove the superseded remoteOverride module

**Files:**
- Delete: `src/utils/remoteOverride.ts`, `tests/unit/remoteOverride.test.ts`

- [ ] **Step 1: Confirm no remaining references**

Run: `npx vitest run --config tests/vitest.config.ts >/dev/null; grep -rn "remoteOverride\|resolveEffectiveRemote\|manualRemote\|markRemote" src tests`
Expected: no matches (all replaced in Tasks 2-4).

- [ ] **Step 2: Delete the files**

```bash
git rm src/utils/remoteOverride.ts tests/unit/remoteOverride.test.ts
```

- [ ] **Step 3: Typecheck + full suite + build**

Run: `npx tsc --noEmit && npx vitest run --config tests/vitest.config.ts && npx vite build`
Expected: tsc clean; all tests pass; build succeeds.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore(remote-ai): remove superseded remoteOverride module"
```

---

## Self-review notes

- **Spec coverage:** bridge (Task 4 onSshSession), pill lifecycle offer/installing/active (Tasks 1-3), watch context (Task 5), run via daemon (Task 4), composer-lock change (Task 6), removed `⥂`/remoteOverride (Tasks 3,7), AI host tag — *partial*: the design's "AI replies carry a `piclock` tag" is not yet a task. See open item below.
- **IPC verified:** `daemon.check` / `daemon.install` / `ai.setDaemonEnabled` all exist in `electron/preload.ts` as Task 4 uses them.
- **Deferred (not blocking):** the reply `host` tag (UI-only, additive) — add as a follow-up after the core flow works, or fold into Task 5 by tagging the AI block's metadata. Left out of the critical path to keep tasks focused.
