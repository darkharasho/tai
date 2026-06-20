# Sudo Credential Caching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user authenticate `sudo` once per app run; subsequent `sudo` prompts are auto-filled from an in-memory, opt-in credential cache, gated so the secret only ever reaches a real `sudo` prompt.

**Architecture:** The plaintext secret lives only in the Electron main process (a single-slot in-memory `CredentialVault`). The existing `TermiosPoller` already detects echo-off password prompts; we resolve the PTY's foreground process from `/proc` and, when it is `sudo` and a secret is cached, the main process writes the secret to the PTY directly instead of surfacing the widget. The renderer only sends a "remember" intent plus the characters it already streams to the PTY today; it never receives the stored value back.

**Tech Stack:** Electron (main + preload + React renderer), TypeScript, `node-pty`, `node-termios`, Vitest (`vitest run --config tests/vitest.config.ts`), dependency-injected readers for testability.

## Global Constraints

- Linux only (relies on `/proc`). macOS/Windows: feature disabled, widget behaves exactly as today.
- Secret is in-memory in the main process only: never sent to the renderer, never logged, never written to disk. `clear()` zero-fills the buffer.
- Auto-fill only when the PTY foreground process command is exactly `sudo`. Any uncertainty resolves to "not sudo" → show widget (fail safe, never fail open).
- Opt-in: "Remember for this session" toggle, default **off**.
- Rejection window for invalidation: **2000 ms**.
- One cached secret shared app-wide across all tabs/terminals.
- Cleared on: app quit (`before-quit`), manual "Forget", and auth rejection. (No window-lock trigger — TAI has no lock concept today.)
- Test runner: `npx vitest run --config tests/vitest.config.ts --maxWorkers=2` (per global instruction).
- Follow existing `/proc` parse idiom in `electron/services/pty.ts:337-343` (skip `comm` via `lastIndexOf(')')`, `tpgid` is field index 5).

---

### Task 1: CredentialVault (in-memory single-slot store)

**Files:**
- Create: `electron/services/credentialVault.ts`
- Test: `tests/unit/credentialVault.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `class CredentialVault { set(secret: Buffer): void; get(): Buffer | null; isSet(): boolean; clear(): void }`
  - `const credentialVault: CredentialVault` (shared singleton)

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/credentialVault.test.ts
import { describe, it, expect } from 'vitest';
import { CredentialVault } from '../../electron/services/credentialVault';

describe('CredentialVault', () => {
  it('starts empty', () => {
    const v = new CredentialVault();
    expect(v.isSet()).toBe(false);
    expect(v.get()).toBeNull();
  });

  it('stores and returns the secret', () => {
    const v = new CredentialVault();
    v.set(Buffer.from('hunter2', 'utf8'));
    expect(v.isSet()).toBe(true);
    expect(v.get()?.toString('utf8')).toBe('hunter2');
  });

  it('replacing a secret zero-fills the previous buffer', () => {
    const v = new CredentialVault();
    const first = Buffer.from('old', 'utf8');
    v.set(first);
    v.set(Buffer.from('new', 'utf8'));
    expect(first.every((b) => b === 0)).toBe(true);
    expect(v.get()?.toString('utf8')).toBe('new');
  });

  it('clear() zero-fills and empties', () => {
    const v = new CredentialVault();
    const buf = Buffer.from('secret', 'utf8');
    v.set(buf);
    v.clear();
    expect(v.isSet()).toBe(false);
    expect(v.get()).toBeNull();
    expect(buf.every((b) => b === 0)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config tests/vitest.config.ts tests/unit/credentialVault.test.ts --maxWorkers=2`
Expected: FAIL — cannot find module `credentialVault`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// electron/services/credentialVault.ts

/**
 * Single-slot, in-memory store for the user's sudo password. The plaintext
 * lives only here in the main process — never persisted, never sent to the
 * renderer, never logged. Buffers are zero-filled on release.
 */
export class CredentialVault {
  private _secret: Buffer | null = null;

  set(secret: Buffer): void {
    this._wipe();
    // Copy so callers can't mutate/free our backing store out from under us.
    this._secret = Buffer.from(secret);
  }

  get(): Buffer | null {
    return this._secret;
  }

  isSet(): boolean {
    return this._secret !== null;
  }

  clear(): void {
    this._wipe();
  }

  private _wipe(): void {
    if (this._secret) {
      this._secret.fill(0);
      this._secret = null;
    }
  }
}

export const credentialVault = new CredentialVault();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config tests/vitest.config.ts tests/unit/credentialVault.test.ts --maxWorkers=2`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add electron/services/credentialVault.ts tests/unit/credentialVault.test.ts
git commit -m "feat(sudo): in-memory CredentialVault for cached sudo password"
```

---

### Task 2: Foreground-process resolver (`/proc` → is it sudo?)

**Files:**
- Create: `electron/services/foregroundProcess.ts`
- Test: `tests/unit/foregroundProcess.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type Foreground = 'sudo' | 'other' | 'unknown'`
  - `function resolveForeground(shellPid: number, readFile?: (path: string) => string): Foreground`
  - `readFile` defaults to a synchronous UTF-8 `/proc` reader; injectable for tests.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/foregroundProcess.test.ts
import { describe, it, expect } from 'vitest';
import { resolveForeground } from '../../electron/services/foregroundProcess';

// stat layout: "<pid> (<comm>) <state> <ppid> <pgrp> <session> <tty_nr> <tpgid> ..."
// After slicing past ") ", tpgid is field index 5.
function statWithTpgid(tpgid: number): string {
  return `100 (bash) S 99 100 100 34816 ${tpgid} 4194304 ...rest...`;
}

describe('resolveForeground', () => {
  it('returns "sudo" when the foreground comm is sudo', () => {
    const fakeRead = (p: string) => {
      if (p === '/proc/100/stat') return statWithTpgid(200);
      if (p === '/proc/200/comm') return 'sudo\n';
      throw new Error('unexpected path ' + p);
    };
    expect(resolveForeground(100, fakeRead)).toBe('sudo');
  });

  it('returns "other" when the foreground comm is not sudo', () => {
    const fakeRead = (p: string) => {
      if (p === '/proc/100/stat') return statWithTpgid(200);
      if (p === '/proc/200/comm') return 'ssh\n';
      throw new Error('unexpected path ' + p);
    };
    expect(resolveForeground(100, fakeRead)).toBe('other');
  });

  it('handles a comm containing spaces/parens via lastIndexOf(")")', () => {
    const fakeRead = (p: string) => {
      if (p === '/proc/100/stat') return `100 (weird ) name) S 99 100 100 34816 200 0 ...`;
      if (p === '/proc/200/comm') return 'sudo\n';
      throw new Error('unexpected path ' + p);
    };
    expect(resolveForeground(100, fakeRead)).toBe('sudo');
  });

  it('returns "unknown" when tpgid is invalid', () => {
    const fakeRead = (p: string) => {
      if (p === '/proc/100/stat') return statWithTpgid(-1);
      throw new Error('unexpected path ' + p);
    };
    expect(resolveForeground(100, fakeRead)).toBe('unknown');
  });

  it('returns "unknown" when a read throws', () => {
    const fakeRead = (_p: string): string => { throw new Error('ENOENT'); };
    expect(resolveForeground(100, fakeRead)).toBe('unknown');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config tests/vitest.config.ts tests/unit/foregroundProcess.test.ts --maxWorkers=2`
Expected: FAIL — cannot find module `foregroundProcess`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// electron/services/foregroundProcess.ts
import * as fs from 'fs';

export type Foreground = 'sudo' | 'other' | 'unknown';

function defaultReadFile(path: string): string {
  return fs.readFileSync(path, 'utf8');
}

/**
 * Resolve whether the foreground process of the shell's controlling terminal
 * is `sudo`, using only `/proc`. `tpgid` (the controlling tty's foreground
 * process-group id) lives in the shell's stat line; its leader's `comm` is the
 * program waiting on the tty (e.g. `sudo`). Any failure resolves to 'unknown'
 * so callers fail safe (treat as not-sudo).
 */
export function resolveForeground(
  shellPid: number,
  readFile: (path: string) => string = defaultReadFile,
): Foreground {
  try {
    const stat = readFile(`/proc/${shellPid}/stat`);
    // comm is parenthesized and may contain spaces/parens — skip to the last ')'.
    const closeParenIdx = stat.lastIndexOf(')');
    if (closeParenIdx < 0) return 'unknown';
    const fields = stat.slice(closeParenIdx + 2).split(' ');
    const tpgid = parseInt(fields[5], 10);
    if (!(tpgid > 0)) return 'unknown';
    const comm = readFile(`/proc/${tpgid}/comm`).trim();
    if (!comm) return 'unknown';
    return comm === 'sudo' ? 'sudo' : 'other';
  } catch {
    return 'unknown';
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config tests/vitest.config.ts tests/unit/foregroundProcess.test.ts --maxWorkers=2`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add electron/services/foregroundProcess.ts tests/unit/foregroundProcess.test.ts
git commit -m "feat(sudo): /proc foreground-process resolver (sudo gate)"
```

---

### Task 3: Auto-fill decision (pure function)

**Files:**
- Create: `electron/services/sudoAutoFill.ts`
- Test: `tests/unit/sudoAutoFill.test.ts`

**Interfaces:**
- Consumes: `Foreground` from `foregroundProcess.ts`.
- Produces:
  - `const REJECT_WINDOW_MS = 2000`
  - `type AutoFillDecision = 'auto-fill' | 'reject' | 'prompt'`
  - `function decideAutoFill(input: { foreground: Foreground; vaultSet: boolean; msSinceLastAutoFill: number | null }): AutoFillDecision`
  - Only called when a password prompt (`!echo && icanon`) has been detected.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/sudoAutoFill.test.ts
import { describe, it, expect } from 'vitest';
import { decideAutoFill, REJECT_WINDOW_MS } from '../../electron/services/sudoAutoFill';

describe('decideAutoFill', () => {
  it('auto-fills when sudo + cached + no recent auto-fill', () => {
    expect(decideAutoFill({ foreground: 'sudo', vaultSet: true, msSinceLastAutoFill: null }))
      .toBe('auto-fill');
  });

  it('auto-fills when the last auto-fill is older than the reject window', () => {
    expect(decideAutoFill({ foreground: 'sudo', vaultSet: true, msSinceLastAutoFill: REJECT_WINDOW_MS + 1 }))
      .toBe('auto-fill');
  });

  it('rejects (cached secret was wrong) when sudo re-prompts within the window', () => {
    expect(decideAutoFill({ foreground: 'sudo', vaultSet: true, msSinceLastAutoFill: 500 }))
      .toBe('reject');
  });

  it('prompts when nothing is cached', () => {
    expect(decideAutoFill({ foreground: 'sudo', vaultSet: false, msSinceLastAutoFill: null }))
      .toBe('prompt');
  });

  it('prompts (never auto-fills) for non-sudo foreground even if cached', () => {
    expect(decideAutoFill({ foreground: 'other', vaultSet: true, msSinceLastAutoFill: null }))
      .toBe('prompt');
  });

  it('prompts for unknown foreground (fail safe)', () => {
    expect(decideAutoFill({ foreground: 'unknown', vaultSet: true, msSinceLastAutoFill: null }))
      .toBe('prompt');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config tests/vitest.config.ts tests/unit/sudoAutoFill.test.ts --maxWorkers=2`
Expected: FAIL — cannot find module `sudoAutoFill`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// electron/services/sudoAutoFill.ts
import type { Foreground } from './foregroundProcess';

/** A sudo re-prompt within this window after an auto-fill means the cached
 *  secret was wrong — invalidate it instead of replaying it again. */
export const REJECT_WINDOW_MS = 2000;

export type AutoFillDecision = 'auto-fill' | 'reject' | 'prompt';

/**
 * Decide what to do on a detected password prompt. Only ever auto-fills a real
 * `sudo` foreground; everything else falls back to the widget.
 */
export function decideAutoFill(input: {
  foreground: Foreground;
  vaultSet: boolean;
  msSinceLastAutoFill: number | null;
}): AutoFillDecision {
  const { foreground, vaultSet, msSinceLastAutoFill } = input;
  if (foreground !== 'sudo' || !vaultSet) return 'prompt';
  if (msSinceLastAutoFill !== null && msSinceLastAutoFill <= REJECT_WINDOW_MS) {
    return 'reject';
  }
  return 'auto-fill';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config tests/vitest.config.ts tests/unit/sudoAutoFill.test.ts --maxWorkers=2`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add electron/services/sudoAutoFill.ts tests/unit/sudoAutoFill.test.ts
git commit -m "feat(sudo): pure auto-fill decision (sudo gate + reject window)"
```

---

### Task 4: Wire vault + auto-fill into the PTY service and IPC

**Files:**
- Modify: `electron/services/pty.ts` (poller callback ~233-240; IPC handlers near `pty:start-echo-poll` ~323; imports at top)
- Modify: `electron/preload.ts` (`pty` block ~26-34)
- Modify: `electron/main.ts` (`before-quit` ~124-130)

**Interfaces:**
- Consumes: `credentialVault` (Task 1), `resolveForeground` (Task 2), `decideAutoFill`/`REJECT_WINDOW_MS` (Task 3).
- Produces (preload `window.tai.pty`):
  - `rememberSecret(secret: string): void` → `ipcRenderer.send('pty:remember-secret', secret)`
  - `forgetSecret(): void` → `ipcRenderer.send('pty:forget-secret')`
  - `onAutoAuth(cb: (id: number) => void): () => void` ← `'pty:auto-auth'`
  - `onSecretState(cb: (cached: boolean) => void): () => void` ← `'pty:secret-state'`

- [ ] **Step 1: Add imports at the top of `electron/services/pty.ts`**

Add alongside the existing service imports:

```typescript
import { credentialVault } from './credentialVault';
import { resolveForeground } from './foregroundProcess';
import { decideAutoFill } from './sudoAutoFill';
```

- [ ] **Step 2: Replace the poller `onChange` callback to apply the auto-fill decision**

Find (in the `pty:create` handler, ~lines 232-240):

```typescript
        const reader = defaultTermiosReader();
        poller = new TermiosPoller(masterFd, reader, (e) => {
          safeSend('pty:echo-change', id, {
            echo: e.echo,
            icanon: e.icanon,
            passwordPrompt: e.passwordPrompt,
            interactiveProgram: e.interactiveProgram,
          });
        });
```

Replace with:

```typescript
        const reader = defaultTermiosReader();
        poller = new TermiosPoller(masterFd, reader, (e) => {
          if (e.passwordPrompt && process.platform === 'linux') {
            const foreground = resolveForeground(term.pid);
            const last = lastAutoFillAt.get(id) ?? null;
            const decision = decideAutoFill({
              foreground,
              vaultSet: credentialVault.isSet(),
              msSinceLastAutoFill: last === null ? null : Date.now() - last,
            });
            if (decision === 'auto-fill') {
              const secret = credentialVault.get();
              if (secret) {
                try { term.write(secret.toString('utf8') + '\n'); } catch {}
                lastAutoFillAt.set(id, Date.now());
                safeSend('pty:auto-auth', id);
                return; // do NOT surface the widget
              }
            } else if (decision === 'reject') {
              credentialVault.clear();
              lastAutoFillAt.delete(id);
              safeSend('pty:secret-state', false);
              // fall through to surface the widget for a fresh attempt
            }
          }
          safeSend('pty:echo-change', id, {
            echo: e.echo,
            icanon: e.icanon,
            passwordPrompt: e.passwordPrompt,
            interactiveProgram: e.interactiveProgram,
          });
        });
```

- [ ] **Step 3: Add the per-PTY auto-fill timestamp map**

Near the top of the module where `allTerminals` is declared, add:

```typescript
// Tracks the last time we auto-filled a sudo prompt per PTY, so a fast
// re-prompt (sudo rejecting the cached secret) can invalidate the cache.
const lastAutoFillAt = new Map<number, number>();
```

In the `term.onExit(...)` handler (~line 248), add cleanup:

```typescript
      lastAutoFillAt.delete(id);
```

- [ ] **Step 4: Add the remember/forget IPC handlers**

After the `pty:stop-echo-poll` handler (~line 329), add:

```typescript
  ipcMain.on('pty:remember-secret', (_event, secret: string) => {
    if (typeof secret !== 'string' || secret.length === 0) return;
    credentialVault.set(Buffer.from(secret, 'utf8'));
    safeSend('pty:secret-state', true);
  });

  ipcMain.on('pty:forget-secret', () => {
    credentialVault.clear();
    safeSend('pty:secret-state', false);
  });
```

- [ ] **Step 5: Expose the new channels in `electron/preload.ts`**

Inside the `pty: { ... }` object (after `stopEchoPoll`, ~line 28), add:

```typescript
    rememberSecret: (secret: string) => ipcRenderer.send('pty:remember-secret', secret),
    forgetSecret: () => ipcRenderer.send('pty:forget-secret'),
    onAutoAuth: (callback: (id: number) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, id: number) => callback(id);
      ipcRenderer.on('pty:auto-auth', listener);
      return () => ipcRenderer.removeListener('pty:auto-auth', listener);
    },
    onSecretState: (callback: (cached: boolean) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, cached: boolean) => callback(cached);
      ipcRenderer.on('pty:secret-state', listener);
      return () => ipcRenderer.removeListener('pty:secret-state', listener);
    },
```

- [ ] **Step 6: Clear the vault on quit in `electron/main.ts`**

Add the import near the other service imports:

```typescript
import { credentialVault } from './services/credentialVault';
```

In the `before-quit` handler (~line 124), add as the first line of the body:

```typescript
  credentialVault.clear();
```

- [ ] **Step 7: Typecheck and run the full unit suite**

Run: `npx tsc --noEmit && npx vitest run --config tests/vitest.config.ts --maxWorkers=2`
Expected: typecheck clean; all existing tests plus Tasks 1-3 tests PASS. (No new automated test here — the wired pure units are already covered; `ipcMain`/`node-pty` wiring is verified in the manual smoke at Task 7.)

- [ ] **Step 8: Commit**

```bash
git add electron/services/pty.ts electron/preload.ts electron/main.ts
git commit -m "feat(sudo): wire credential vault + auto-fill into PTY service and IPC"
```

---

### Task 5: "Remember for this session" toggle in the password widget

**Files:**
- Modify: `src/components/PasswordPrompt.tsx`

**Interfaces:**
- Consumes: `window.tai.pty.rememberSecret` (Task 4).
- Produces: no new exports; `PasswordPrompt` now optionally caches the typed secret on submit.

- [ ] **Step 1: Track the toggle and accumulate typed characters**

Replace the body of `PasswordPrompt` (the `useState`/refs and `handleKeyDown`) so it captures characters into a ref and exposes a checkbox. Full replacement for the component:

```tsx
import { useState, useRef, useEffect } from 'react';

interface PasswordPromptProps {
  ptyId: number;
  onDone: () => void;
}

export function PasswordPrompt({ ptyId, onDone }: PasswordPromptProps) {
  const [dots, setDots] = useState(0);
  const [remember, setRemember] = useState(false);
  const secretRef = useRef('');
  const rememberRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => { rememberRef.current = remember; }, [remember]);
  useEffect(() => { containerRef.current?.focus(); }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Enter') {
      if (rememberRef.current && secretRef.current.length > 0) {
        window.tai?.pty?.rememberSecret?.(secretRef.current);
      }
      secretRef.current = '';
      window.tai?.pty?.write(ptyId, '\n');
      setDots(0);
      onDone();
    } else if (e.key === 'Backspace') {
      if (dots > 0) {
        setDots(d => d - 1);
        secretRef.current = secretRef.current.slice(0, -1);
        window.tai?.pty?.write(ptyId, '\x7f');
      }
    } else if (e.key === 'c' && e.ctrlKey) {
      secretRef.current = '';
      window.tai?.pty?.write(ptyId, '\x03');
      setDots(0);
      onDone();
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      setDots(d => d + 1);
      secretRef.current += e.key;
      window.tai?.pty?.write(ptyId, e.key);
    }
  };

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      style={{
        margin: '0 14px 4px',
        padding: '10px 16px',
        background: 'var(--bg-card)',
        border: '1px solid rgba(234, 179, 8, 0.2)',
        borderRadius: '10px',
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        fontFamily: 'var(--font-mono)',
        fontSize: '13px',
        outline: 'none',
        cursor: 'text',
      }}
    >
      <span style={{ color: '#eab308', fontSize: '14px', flexShrink: 0 }}>&#x1F512;</span>
      <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>Password:</span>
      <span style={{ color: 'var(--text-primary)', letterSpacing: '2px', minHeight: '18px', flex: 1 }}>
        {'•'.repeat(dots)}
        <span style={{ opacity: 0.5, animation: 'pulse 1s ease-in-out infinite' }}>|</span>
      </span>
      <label
        onKeyDown={(e) => e.stopPropagation()}
        style={{ color: 'var(--text-muted)', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '5px', flexShrink: 0, cursor: 'pointer' }}
      >
        <input
          type="checkbox"
          checked={remember}
          onChange={(e) => setRemember(e.target.checked)}
          tabIndex={-1}
          style={{ cursor: 'pointer' }}
        />
        Remember for this session
      </label>
      <span style={{ color: 'var(--text-muted)', fontSize: '10px', flexShrink: 0 }}>Enter to submit</span>
    </div>
  );
}
```

Note: the checkbox `onChange` fires from a mouse click (the widget swallows key events via `handleKeyDown`); `tabIndex={-1}` keeps keyboard focus on the password container so typing still flows to the PTY.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/PasswordPrompt.tsx
git commit -m "feat(sudo): add opt-in 'Remember for this session' toggle to password widget"
```

---

### Task 6: Cached-secret indicator + auto-auth flash

**Files:**
- Create: `src/components/SudoCacheBadge.tsx`
- Modify: `src/components/TerminalSession.tsx` (listener registration near the `onEchoChange` wiring ~672; render near the component's root return)

**Interfaces:**
- Consumes: `window.tai.pty.onSecretState`, `window.tai.pty.onAutoAuth`, `window.tai.pty.forgetSecret` (Task 4).
- Produces: `SudoCacheBadge` — a small fixed-position pill; click to forget the cached secret; flashes on auto-auth.

- [ ] **Step 1: Create the badge component**

```tsx
// src/components/SudoCacheBadge.tsx
import { useEffect, useState } from 'react';

interface SudoCacheBadgeProps {
  cached: boolean;
  flash: boolean;        // briefly true right after an auto-fill
  onForget: () => void;
}

export function SudoCacheBadge({ cached, flash, onForget }: SudoCacheBadgeProps) {
  const [hover, setHover] = useState(false);
  if (!cached) return null;
  const label = flash ? '\u{1F513} sudo authenticated' : (hover ? '\u{1F513} forget sudo' : '\u{1F512} sudo cached');
  return (
    <button
      onClick={onForget}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title="Forget cached sudo password"
      style={{
        position: 'absolute',
        bottom: 10,
        right: 28,
        zIndex: 20,
        padding: '3px 9px',
        borderRadius: 999,
        border: '1px solid rgba(234, 179, 8, 0.3)',
        background: 'var(--bg-card)',
        color: 'var(--text-muted)',
        fontFamily: 'var(--font-mono)',
        fontSize: 10,
        cursor: 'pointer',
        opacity: flash ? 1 : 0.7,
        transition: 'opacity 120ms ease',
      }}
    >
      {label}
    </button>
  );
}

/** Convenience hook: subscribe to vault state + auto-auth flashes for one PTY. */
export function useSudoCacheState(ptyId: number | null) {
  const [cached, setCached] = useState(false);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    const offState = window.tai?.pty?.onSecretState?.((c) => setCached(c));
    let timer: ReturnType<typeof setTimeout> | null = null;
    const offAuth = window.tai?.pty?.onAutoAuth?.((id) => {
      if (ptyId !== null && id !== ptyId) return;
      setFlash(true);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setFlash(false), 1500);
    });
    return () => {
      offState?.();
      offAuth?.();
      if (timer) clearTimeout(timer);
    };
  }, [ptyId]);

  return { cached, flash };
}
```

- [ ] **Step 2: Wire the hook + badge into `TerminalSession.tsx`**

Add the import near the other component imports:

```tsx
import { SudoCacheBadge, useSudoCacheState } from './SudoCacheBadge';
```

Near the other hook calls at the top of the `TerminalSession` function body (e.g. just after the `passwordPrompt` state at line 181), add:

```tsx
  const sudoCache = useSudoCacheState(ptyId);
```

Then render the badge inside the component's outermost container. Locate the root return's top-level wrapper `<div>` (the one that contains the main content and the `HiddenXterm` home) and add, as a direct child of it (so the badge's `position: absolute` anchors to the session, which must be `position: relative`):

```tsx
        <SudoCacheBadge
          cached={sudoCache.cached}
          flash={sudoCache.flash}
          onForget={() => window.tai?.pty?.forgetSecret?.()}
        />
```

If the session's outer wrapper does not already have `position: relative`, add `position: 'relative'` to its style so the badge anchors correctly.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/SudoCacheBadge.tsx src/components/TerminalSession.tsx
git commit -m "feat(sudo): cached-secret badge with click-to-forget and auto-auth flash"
```

---

### Task 7: Manual smoke verification (real shell gate)

**Files:** none (manual).

This gate exists because `ipcMain` + `node-pty` + real `/proc`/termios cannot be exercised by Vitest. Run the app (`npm run dev` or the project's run skill) and verify on Linux:

- [ ] **Step 1: First sudo, no remember.** Run `sudo -k; sudo true`. Widget appears; type password without checking "Remember"; succeeds. Run `sudo -k; sudo true` again → widget appears again (nothing cached). ✔ matches today's behavior.
- [ ] **Step 2: Remember + auto-fill.** Run `sudo -k; sudo true`, check "Remember for this session", submit. Confirm the `🔒 sudo cached` badge appears. Run `sudo -k; sudo true` again → **no widget**; badge flashes `🔓 sudo authenticated`; command succeeds.
- [ ] **Step 3: Cross-tab.** Open a second tab, run `sudo -k; sudo true` → auto-fills (cache is app-wide).
- [ ] **Step 4: No leak to non-sudo.** With a secret cached, run `ssh localhost` (or `gpg` / `mysql -p`). Confirm the **widget appears** and the cached secret is NOT auto-submitted (foreground ≠ sudo).
- [ ] **Step 5: Rejection invalidates.** Run `sudo -k; sudo true`, remember a **wrong** password. Re-run `sudo -k; sudo true` → auto-fill attempt fails, sudo re-prompts within 2 s → cache clears (badge disappears), widget shown for retry.
- [ ] **Step 6: Forget + quit.** Click the badge → it disappears and a subsequent `sudo -k; sudo true` prompts again. Restart the app → no secret cached.
- [ ] **Step 7: Shells.** Repeat Step 2 under bash, zsh, and fish (TAI's three integrated shells).

- [ ] **Step 8: Commit any fixes found during smoke, then finalize.**

```bash
git add -A && git commit -m "fix(sudo): address manual-smoke findings for credential caching"
```

---

## Self-Review

**Spec coverage:**
- Lifetime (in-memory, cleared on quit/manual/rejection) → Tasks 1, 4 (before-quit + forget + reject), 6 (forget UI). ✔
- Shared app-wide → singleton vault (Task 1), app-wide `secret-state` (Task 4). ✔
- Opt-in toggle default off → Task 5. ✔
- Foreground-is-sudo gate → Tasks 2, 3, 4. ✔
- Invalidate on rejection (2000 ms) → Tasks 3 (`REJECT_WINDOW_MS`), 4 (reject branch). ✔
- Auto-replay to PTY → Task 4 Step 2. ✔
- Status indicator + auto-auth flash → Task 6. ✔
- Security (main-only, no disk, zero-fill, fail-safe) → Tasks 1, 2, 3, 4. ✔
- Non-Linux disabled → Task 4 Step 2 (`process.platform === 'linux'` guard). ✔
- Testing (unit + manual smoke incl. no-leak + shells) → Tasks 1-3 unit, Task 7 manual. ✔

**Placeholder scan:** none — every code/command step is concrete.

**Type consistency:** `Foreground` (Task 2) consumed by `decideAutoFill` (Task 3) and `pty.ts` (Task 4). `AutoFillDecision` values `'auto-fill' | 'reject' | 'prompt'` used consistently in Task 4. Preload names (`rememberSecret`, `forgetSecret`, `onAutoAuth`, `onSecretState`) match their consumers in Tasks 5-6. `credentialVault` singleton name consistent across Tasks 1, 4. ✔
