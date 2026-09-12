# AI sudo via TAI askpass — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When TAI's AI runs `sudo` (no tty → `$SUDO_ASKPASS`), answer it from TAI's own password field inside the AI block and from the shared session cache, instead of `ksshaskpass`.

**Architecture:** A main-process broker listens on a private Unix socket. A generated helper (the `SUDO_ASKPASS` target) connects and reports its pid. The broker verifies the helper's parent is a root-privileged `sudo`, then either auto-fills from `credentialVault` (after a short duplicate-claim hold) or asks the renderer for a password via `ai:message`. On both Linux and macOS the secret is returned to the helper over the socket, which prints it to sudo. Each helper pid is answered at most once, and any duplicate claim on a pid refuses both requests, clears the vault and warns in the AI block.

**Tech Stack:** Electron 36 main process (Node `net`, `fs`, `child_process`), React renderer, vitest (node + jsdom), POSIX sh.

**Spec:** `docs/superpowers/specs/2026-09-12-ai-sudo-askpass-design.md`

## Global Constraints

- Platforms: Linux and macOS only. On `win32` nothing is started and no env vars are set.
- The plaintext secret is never logged, never placed in an environment variable, never sent to the renderer, never included in any `ai:message` payload. It leaves the main process only as the socket reply `{ ok: true, secret }` to a request whose pid passed the parent check.
- The helper is untrusted. All trust decisions are made in the main process.
- Parent check fails closed: any read/parse error, missing pid, or ambiguity → refuse.
- Single use per helper pid: a pid is answered at most once. A second claim on a pid with a pending or answered request (same verified sudo parent) refuses both, clears the vault, sends `pty:secret-state false` and `sudo_resolved` `outcome: 'refused-duplicate'`.
- Auto-fill waits `AUTOFILL_HOLD_MS = 150` before replying so a near-simultaneous duplicate trips the wire first.
- Cached secret is replayed at most once per sudo process (same sudo pid re-asking → clear cache and prompt). Fedora `pam_faillock` locks after 3 failures.
- No separate `sudo -S -v` validation (it would spend a faillock attempt).
- Prompt timeout: 5 minutes (`5 * 60_000` ms).
- Env vars are merged only at the three AI spawn sites (`claude.ts`, `codex.ts`, `gemini.ts`), never in `platform.enrichEnv()` and never into `process.env`, so terminal PTYs are unaffected.
- Vitest: always run through `npm test` / `npx vitest run --config tests/vitest.config.ts` (config pins `maxForks: 2`, `maxWorkers: 2`).
- Typecheck gates:
  - `npx tsc --noEmit -p tsconfig.json` → exit 0.
  - `npx tsc --noEmit -p tsconfig.node.json 2>&1 | grep 'error TS' | grep -v TS6307` → exactly two lines, the pre-existing errors, matched by file and message text **regardless of line/column** (this plan adds imports above both):
    - `electron/main.ts(<line>,<col>): error TS2339: Property 'setDesktopName' does not exist on type 'App'.`
    - `electron/services/claude.ts(<line>,<col>): error TS2322: Type '{ abortController: AbortController; env: ...` (the SDK `Options` mismatch at the `query({ options })` call)
    - Any other `error TS` line, or a third line, fails the gate.
- Commits end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## File Map

| File | Status | Responsibility |
|---|---|---|
| `electron/services/sudoParent.ts` | create | Pure parsers + `resolveSudoParent(pid)` → sudo pid or null |
| `electron/services/askpassDecision.ts` | create | Pure `decideAskpass()` |
| `electron/services/askpassHelper.ts` | create | Generate sh wrapper + `.cjs` helper; `buildAskpassEnv()`; `sweepStaleAskpassDirs()` |
| `electron/services/askpassBroker.ts` | create | `AskpassBroker` class: claims, duplicate tripwire, queue, decide, auto-fill hold, reply, cancel, timeout |
| `electron/services/askpassServer.ts` | create | `startAskpassServer()` Unix socket + `parseAskpassRequest()` |
| `electron/services/askpassService.ts` | create | Singleton wiring: temp dir, files, server, IPC, `askpassEnvFor()`, `cancelAskpassForKey()`, `stopAskpassService()` |
| `electron/main.ts` | modify | start/stop service |
| `electron/services/claude.ts`, `codex.ts`, `gemini.ts` | modify | merge env; cancel on stop |
| `electron/preload.ts`, `src/types/window.d.ts` | modify | `ai.sudoAnswer`, `ai.sudoCancel` |
| `src/components/PasswordField.tsx` | create | Presentational password field (extracted from `PasswordPrompt`) |
| `src/components/PasswordPrompt.tsx` | modify | Thin terminal wrapper over `PasswordField` (behaviour unchanged) |
| `src/components/SudoPrompt.tsx` | create | AI wrapper over `PasswordField` |
| `src/components/BlockList.tsx` (+ `.module.css`) | modify | `sudo` display item + render |
| `src/components/TerminalSession.tsx` | modify | handle `sudo_prompt` / `sudo_resolved` (incl. `refused-duplicate`) / `sudo_auth` in the always-on per-tab listener; cancel pending sudo items on Stop; keep composer focus-restore off while a sudo field is pending; report needs-input |
| `src/utils/sudoDisplay.ts` | create | `hasPendingSudo(items)`, `applySudoResolved(items, …)`, `cancelPendingSudo(items)` |
| `src/types.ts`, `src/App.tsx`, `src/components/TabSidebar.tsx` (+ `.module.css`) | modify | `aiNeedsInput` marker |
| `.github/workflows/test.yml` | modify | macOS job running the askpass tests |

---

### Task 1: Feasibility probe — DONE (2026-09-12)

Run by the user on Fedora/Bazzite, sudo 1.9.17p2, `yama.ptrace_scope=0`, `fs.suid_dumpable=2`. Nothing committed.

- [x] **Check A (parent identity) — PASS.** The askpass helper's parent shows `Name: sudo`, `Uid: 1000 0 0 0`. `resolveSudoParent` (Task 2) stands as designed.
- [x] **Check B (write the secret into the helper's stdout via `/proc/<askpass pid>/fd/1`) — FAIL.** `EACCES`: sudo's askpass child is non-dumpable, so its `/proc` fd entries are root-only. Design changed: the secret is returned over the socket on both platforms, with single-use pids, a duplicate-claim tripwire and an auto-fill hold (Task 5).
- [ ] **Check C (does a cancelled askpass count as a `faillock` failure) — unverified.** Not reached. Record it during Task 9 in-app verification (step 7).

---

### Task 2: `sudoParent` — verify the helper's parent is root-privileged sudo

**Files:**
- Create: `electron/services/sudoParent.ts`
- Test: `tests/unit/sudoParent.test.ts`

**Interfaces:**
- Produces:
  - `interface ProcIdentity { name: string; uids: number[] }`
  - `parsePpidFromStat(stat: string): number | null`
  - `parseProcStatus(status: string): ProcIdentity | null`
  - `parsePsPpid(out: string): number | null`
  - `parsePsIdentity(out: string): ProcIdentity | null`
  - `isRootSudo(id: ProcIdentity | null): boolean`
  - `interface SudoParentDeps { platform: NodeJS.Platform; readFile(path: string): string; run(cmd: string, args: string[]): string }`
  - `resolveSudoParent(pid: number, deps?: SudoParentDeps): number | null` — returns the sudo pid when verified, else `null`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/sudoParent.test.ts
import { describe, it, expect } from 'vitest';
import {
  parsePpidFromStat, parseProcStatus, parsePsPpid, parsePsIdentity,
  isRootSudo, resolveSudoParent, type SudoParentDeps,
} from '../../electron/services/sudoParent';

const SUDO_STATUS = 'Name:\tsudo\nUmask:\t0022\nState:\tS (sleeping)\nUid:\t1000\t0\t0\t0\nGid:\t1000\t1000\t1000\t1000\n';

describe('parsers', () => {
  it('reads ppid from /proc stat, tolerating spaces and parens in comm', () => {
    expect(parsePpidFromStat('4242 (askpass) S 4100 4242 4000 0 -1')).toBe(4100);
    expect(parsePpidFromStat('4242 (weird (name) x) S 4100 4242')).toBe(4100);
  });

  it('rejects ppid 0/1 and garbage', () => {
    expect(parsePpidFromStat('4242 (a) S 1 4242')).toBeNull();
    expect(parsePpidFromStat('4242 (a) S 0 4242')).toBeNull();
    expect(parsePpidFromStat('garbage')).toBeNull();
    expect(parsePpidFromStat('')).toBeNull();
  });

  it('reads name and all uids from /proc status', () => {
    expect(parseProcStatus(SUDO_STATUS)).toEqual({ name: 'sudo', uids: [1000, 0, 0, 0] });
    expect(parseProcStatus('Name:\tsudo\n')).toBeNull();
    expect(parseProcStatus('')).toBeNull();
  });

  it('reads ps output', () => {
    expect(parsePsPpid('  4100\n')).toBe(4100);
    expect(parsePsPpid('\n')).toBeNull();
    expect(parsePsIdentity('sudo              501     0     0\n')).toEqual({ name: 'sudo', uids: [501, 0, 0] });
    expect(parsePsIdentity('sudo\n')).toBeNull();
  });

  it('isRootSudo requires name sudo and some uid 0', () => {
    expect(isRootSudo({ name: 'sudo', uids: [1000, 0, 0, 0] })).toBe(true);
    expect(isRootSudo({ name: 'sudo', uids: [1000, 1000, 1000, 1000] })).toBe(false);
    expect(isRootSudo({ name: 'bash', uids: [0, 0, 0, 0] })).toBe(false);
    expect(isRootSudo({ name: 'sudo', uids: [] })).toBe(false);
    expect(isRootSudo(null)).toBe(false);
  });
});

function linuxDeps(files: Record<string, string>): SudoParentDeps {
  return {
    platform: 'linux',
    readFile: (p) => { if (p in files) return files[p]; throw new Error('ENOENT'); },
    run: () => { throw new Error('ps must not be used on linux'); },
  };
}

describe('resolveSudoParent (linux)', () => {
  it('returns the sudo pid for a root-privileged sudo parent', () => {
    const deps = linuxDeps({ '/proc/4242/stat': '4242 (node) S 4100 1 1', '/proc/4100/status': SUDO_STATUS });
    expect(resolveSudoParent(4242, deps)).toBe(4100);
  });

  it('refuses a user-owned process named sudo', () => {
    const deps = linuxDeps({
      '/proc/4242/stat': '4242 (node) S 4100 1 1',
      '/proc/4100/status': 'Name:\tsudo\nUid:\t1000\t1000\t1000\t1000\n',
    });
    expect(resolveSudoParent(4242, deps)).toBeNull();
  });

  it('refuses a root parent that is not sudo', () => {
    const deps = linuxDeps({
      '/proc/4242/stat': '4242 (node) S 4100 1 1',
      '/proc/4100/status': 'Name:\tsystemd\nUid:\t0\t0\t0\t0\n',
    });
    expect(resolveSudoParent(4242, deps)).toBeNull();
  });

  it('refuses when anything is unreadable or the pid is invalid', () => {
    expect(resolveSudoParent(4242, linuxDeps({}))).toBeNull();
    expect(resolveSudoParent(4242, linuxDeps({ '/proc/4242/stat': '4242 (node) S 4100 1 1' }))).toBeNull();
    expect(resolveSudoParent(0, linuxDeps({}))).toBeNull();
    expect(resolveSudoParent(1, linuxDeps({}))).toBeNull();
    expect(resolveSudoParent(Number.NaN, linuxDeps({}))).toBeNull();
  });
});

describe('resolveSudoParent (darwin)', () => {
  function macDeps(outputs: Record<string, string>): SudoParentDeps {
    return {
      platform: 'darwin',
      readFile: () => { throw new Error('no /proc on darwin'); },
      run: (cmd, args) => {
        const k = `${cmd} ${args.join(' ')}`;
        if (k in outputs) return outputs[k];
        throw new Error(`unexpected ${k}`);
      },
    };
  }

  it('returns the sudo pid via ps', () => {
    const deps = macDeps({
      '/bin/ps -o ppid= -p 4242': ' 4100\n',
      '/bin/ps -o ucomm=,ruid=,uid=,svuid= -p 4100': 'sudo  501  0  0\n',
    });
    expect(resolveSudoParent(4242, deps)).toBe(4100);
  });

  it('refuses when ps fails or identity is not root sudo', () => {
    expect(resolveSudoParent(4242, macDeps({}))).toBeNull();
    const deps = macDeps({
      '/bin/ps -o ppid= -p 4242': ' 4100\n',
      '/bin/ps -o ucomm=,ruid=,uid=,svuid= -p 4100': 'sudo  501  501  501\n',
    });
    expect(resolveSudoParent(4242, deps)).toBeNull();
  });
});

describe('resolveSudoParent (win32)', () => {
  it('always refuses', () => {
    expect(resolveSudoParent(4242, { platform: 'win32', readFile: () => '', run: () => '' })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config tests/vitest.config.ts tests/unit/sudoParent.test.ts`
Expected: FAIL — cannot resolve `../../electron/services/sudoParent`.

- [ ] **Step 3: Implement**

```ts
// electron/services/sudoParent.ts
import * as fs from 'fs';
import { execFileSync } from 'child_process';

/**
 * Is the process that spawned our askpass helper a real, root-privileged sudo?
 *
 * This is the whole trust boundary for AI sudo: the helper, its environment and
 * its socket are all reachable by the AI, so the main process decides who gets
 * a password by looking at the helper's parent. A user process cannot hold uid
 * 0 in any slot (real, effective, saved, fs), and a process that already does
 * is root, so faking the name `sudo` gains nothing.
 *
 * `/proc/<ppid>/exe` is deliberately not used: sudo is setuid and non-dumpable,
 * so readlink on it fails with EACCES for the invoking user.
 *
 * Fails closed: anything unreadable or unparseable is "not sudo".
 */

export interface ProcIdentity {
  name: string;
  uids: number[];
}

export function parsePpidFromStat(stat: string): number | null {
  const close = stat.lastIndexOf(')');
  if (close < 0) return null;
  // After "pid (comm) ": field 0 is state, field 1 is ppid.
  const fields = stat.slice(close + 2).split(' ');
  const ppid = Number.parseInt(fields[1] ?? '', 10);
  return Number.isInteger(ppid) && ppid > 1 ? ppid : null;
}

export function parseProcStatus(status: string): ProcIdentity | null {
  const name = /^Name:\t(.*)$/m.exec(status)?.[1];
  const uidLine = /^Uid:\s+(.*)$/m.exec(status)?.[1];
  if (name === undefined || uidLine === undefined) return null;
  const uids = uidLine.trim().split(/\s+/).map(Number);
  if (uids.length === 0 || uids.some((u) => !Number.isInteger(u))) return null;
  return { name, uids };
}

export function parsePsPpid(out: string): number | null {
  const ppid = Number.parseInt(out.trim(), 10);
  return Number.isInteger(ppid) && ppid > 1 ? ppid : null;
}

export function parsePsIdentity(out: string): ProcIdentity | null {
  const tokens = out.trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return null;
  const uids: number[] = [];
  while (tokens.length > 1 && /^\d+$/.test(tokens[tokens.length - 1])) {
    uids.unshift(Number(tokens.pop()));
  }
  if (uids.length === 0) return null;
  return { name: tokens.join(' '), uids };
}

export function isRootSudo(id: ProcIdentity | null): boolean {
  return !!id && id.name === 'sudo' && id.uids.includes(0);
}

export interface SudoParentDeps {
  platform: NodeJS.Platform;
  readFile(path: string): string;
  run(cmd: string, args: string[]): string;
}

const defaultDeps: SudoParentDeps = {
  platform: process.platform,
  readFile: (p) => fs.readFileSync(p, 'utf8'),
  run: (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', timeout: 2000 }),
};

/** The verified sudo pid that spawned `pid`, or null. */
export function resolveSudoParent(pid: number, deps: SudoParentDeps = defaultDeps): number | null {
  if (!Number.isInteger(pid) || pid <= 1) return null;
  try {
    if (deps.platform === 'linux') {
      const ppid = parsePpidFromStat(deps.readFile(`/proc/${pid}/stat`));
      if (ppid === null) return null;
      return isRootSudo(parseProcStatus(deps.readFile(`/proc/${ppid}/status`))) ? ppid : null;
    }
    if (deps.platform === 'darwin') {
      const ppid = parsePsPpid(deps.run('/bin/ps', ['-o', 'ppid=', '-p', String(pid)]));
      if (ppid === null) return null;
      const id = parsePsIdentity(deps.run('/bin/ps', ['-o', 'ucomm=,ruid=,uid=,svuid=', '-p', String(ppid)]));
      return isRootSudo(id) ? ppid : null;
    }
  } catch {
    return null;
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config tests/vitest.config.ts tests/unit/sudoParent.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add electron/services/sudoParent.ts tests/unit/sudoParent.test.ts
git commit -m "feat(askpass): verify an askpass helper's parent is root sudo

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: `decideAskpass` — pure decision

**Files:**
- Create: `electron/services/askpassDecision.ts`
- Test: `tests/unit/askpassDecision.test.ts`

**Interfaces:**
- Produces:
  - `type AskpassDecision = 'refuse' | 'auto-fill' | 'reject' | 'prompt'`
  - `decideAskpass(input: { sudoPid: number | null; vaultSet: boolean; lastFilledSudoPid: number | null }): AskpassDecision`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/askpassDecision.test.ts
import { describe, it, expect } from 'vitest';
import { decideAskpass } from '../../electron/services/askpassDecision';

describe('decideAskpass', () => {
  it('refuses when the parent is not verified sudo, even with a cached secret', () => {
    expect(decideAskpass({ sudoPid: null, vaultSet: true, lastFilledSudoPid: null })).toBe('refuse');
    expect(decideAskpass({ sudoPid: null, vaultSet: false, lastFilledSudoPid: null })).toBe('refuse');
  });

  it('auto-fills a verified sudo when cached and not yet filled', () => {
    expect(decideAskpass({ sudoPid: 500, vaultSet: true, lastFilledSudoPid: null })).toBe('auto-fill');
  });

  it('auto-fills a DIFFERENT sudo process right after a prior fill', () => {
    expect(decideAskpass({ sudoPid: 501, vaultSet: true, lastFilledSudoPid: 500 })).toBe('auto-fill');
  });

  it('rejects when the SAME sudo process asks again (cached secret was wrong)', () => {
    expect(decideAskpass({ sudoPid: 500, vaultSet: true, lastFilledSudoPid: 500 })).toBe('reject');
  });

  it('prompts when nothing is cached', () => {
    expect(decideAskpass({ sudoPid: 500, vaultSet: false, lastFilledSudoPid: null })).toBe('prompt');
    expect(decideAskpass({ sudoPid: 500, vaultSet: false, lastFilledSudoPid: 500 })).toBe('prompt');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config tests/vitest.config.ts tests/unit/askpassDecision.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// electron/services/askpassDecision.ts
export type AskpassDecision = 'refuse' | 'auto-fill' | 'reject' | 'prompt';

/**
 * What to do with an askpass request. Mirrors decideAutoFill in sudoAutoFill.ts,
 * keyed on the verified sudo pid instead of the terminal's foreground group:
 * the same sudo process asking again means the secret we replayed was wrong,
 * and replaying it a third time would trip pam_faillock.
 */
export function decideAskpass(input: {
  sudoPid: number | null;
  vaultSet: boolean;
  lastFilledSudoPid: number | null;
}): AskpassDecision {
  const { sudoPid, vaultSet, lastFilledSudoPid } = input;
  if (sudoPid === null) return 'refuse';
  if (!vaultSet) return 'prompt';
  if (lastFilledSudoPid !== null && sudoPid === lastFilledSudoPid) return 'reject';
  return 'auto-fill';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config tests/vitest.config.ts tests/unit/askpassDecision.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/services/askpassDecision.ts tests/unit/askpassDecision.test.ts
git commit -m "feat(askpass): pure auto-fill/reject/prompt decision

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Helper script generation and env builder

**Files:**
- Create: `electron/services/askpassHelper.ts`
- Test: `tests/unit/askpassHelper.test.ts`

**Interfaces:**
- Produces:
  - `generateAskpassWrapper(execPath: string, helperPath: string): string`
  - `generateAskpassHelperScript(socketPath: string): string`
  - `buildAskpassEnv(key: string, askpassPath: string | null, platform: NodeJS.Platform): Record<string, string>`
  - `const ASKPASS_DIR_PREFIX = 'tai-askpass-'`, `const ASKPASS_OWNER_FILE = 'owner.pid'`
  - `sweepStaleAskpassDirs(tempDir: string, isAlive?: (pid: number) => boolean): string[]` — removes `tai-askpass-*` directories in `tempDir` owned by the current uid whose `owner.pid` is missing, garbled, or not a live process; returns the removed names. Electron-free (the caller passes the temp dir).
- Wire protocol (used by Tasks 5, 6):
  - helper → broker: one line `{"pid":number,"key":string,"prompt":string}\n`
  - broker → helper: one line `{"ok":boolean,"secret"?:string}\n`
  - helper: `ok === true && typeof secret === 'string'` → print `secret\n`, exit 0; anything else (including `ok` without a secret) / EOF / error → exit 1.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/askpassHelper.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import {
  generateAskpassWrapper, generateAskpassHelperScript, buildAskpassEnv,
  sweepStaleAskpassDirs, ASKPASS_OWNER_FILE,
} from '../../electron/services/askpassHelper';

describe('buildAskpassEnv', () => {
  it('sets both vars on linux and darwin when the helper exists', () => {
    expect(buildAskpassEnv('tab_1', '/tmp/x/askpass', 'linux'))
      .toEqual({ SUDO_ASKPASS: '/tmp/x/askpass', TAI_ASKPASS_KEY: 'tab_1' });
    expect(buildAskpassEnv('tab_1', '/tmp/x/askpass', 'darwin'))
      .toEqual({ SUDO_ASKPASS: '/tmp/x/askpass', TAI_ASKPASS_KEY: 'tab_1' });
  });

  it('sets nothing on win32 or when the broker is not running', () => {
    expect(buildAskpassEnv('tab_1', '/tmp/x/askpass', 'win32')).toEqual({});
    expect(buildAskpassEnv('tab_1', null, 'linux')).toEqual({});
  });

  it('never touches process.env', () => {
    // Compare against the starting values: the suite may itself run under a
    // TAI AI tool, whose env legitimately carries both vars.
    const before = { SUDO_ASKPASS: process.env.SUDO_ASKPASS, TAI_ASKPASS_KEY: process.env.TAI_ASKPASS_KEY };
    buildAskpassEnv('tab_1', '/tmp/x/askpass', 'linux');
    expect({ SUDO_ASKPASS: process.env.SUDO_ASKPASS, TAI_ASKPASS_KEY: process.env.TAI_ASKPASS_KEY }).toEqual(before);
  });
});

describe('generateAskpassWrapper', () => {
  it('execs the given binary as node with the helper and forwards args, quoting paths', () => {
    const sh = generateAskpassWrapper("/opt/it's here/tai", '/tmp/d/askpass.cjs');
    expect(sh.startsWith('#!/bin/sh\n')).toBe(true);
    expect(sh).toContain(`ELECTRON_RUN_AS_NODE=1 exec '/opt/it'\\''s here/tai' '/tmp/d/askpass.cjs' "$@"`);
  });
});

describe.skipIf(process.platform === 'win32')('sweepStaleAskpassDirs', () => {
  let tmp: string;

  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tai-sweep-test-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  function makeDir(name: string, owner?: string): void {
    fs.mkdirSync(path.join(tmp, name));
    fs.writeFileSync(path.join(tmp, name, 'broker.sock.stale'), '');
    if (owner !== undefined) fs.writeFileSync(path.join(tmp, name, ASKPASS_OWNER_FILE), owner);
  }

  it('removes our dead, ownerless and garbled askpass dirs; keeps live ones and unrelated entries', () => {
    makeDir('tai-askpass-dead', '999999');
    makeDir('tai-askpass-live', '4242');
    makeDir('tai-askpass-noowner');
    makeDir('tai-askpass-garbled', 'not a pid');
    makeDir('tai-history-keep', '999999');
    fs.writeFileSync(path.join(tmp, 'tai-askpass-file'), '');

    const removed = sweepStaleAskpassDirs(tmp, (pid) => pid === 4242);

    expect(removed.sort()).toEqual(['tai-askpass-dead', 'tai-askpass-garbled', 'tai-askpass-noowner']);
    expect(fs.readdirSync(tmp).sort()).toEqual(['tai-askpass-file', 'tai-askpass-live', 'tai-history-keep']);
  });

  it('tolerates a missing temp dir', () => {
    expect(sweepStaleAskpassDirs(path.join(tmp, 'nope'))).toEqual([]);
  });
});

describe.skipIf(process.platform === 'win32')('helper process', () => {
  let dir: string;
  let socketPath: string;
  let wrapperPath: string;
  let server: net.Server | null = null;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tai-askpass-test-'));
    socketPath = path.join(dir, 'broker.sock');
    const helperPath = path.join(dir, 'askpass.cjs');
    fs.writeFileSync(helperPath, generateAskpassHelperScript(socketPath), { mode: 0o700 });
    wrapperPath = path.join(dir, 'askpass');
    // vitest runs under plain node; ELECTRON_RUN_AS_NODE is harmless there.
    fs.writeFileSync(wrapperPath, generateAskpassWrapper(process.execPath, helperPath), { mode: 0o700 });
  });

  afterEach(async () => {
    if (server) await new Promise<void>((r) => server!.close(() => r()));
    server = null;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function serve(onLine: (line: string, sock: net.Socket) => void): Promise<void> {
    return new Promise((resolve) => {
      server = net.createServer((sock) => {
        let buf = '';
        sock.setEncoding('utf8');
        sock.on('data', (c: string) => {
          buf += c;
          const nl = buf.indexOf('\n');
          if (nl >= 0) onLine(buf.slice(0, nl), sock);
        });
        sock.on('error', () => {});
      });
      server.listen(socketPath, () => resolve());
    });
  }

  function run(): Promise<{ code: number | null; stdout: string; pid: number }> {
    return new Promise((resolve) => {
      const child = spawn(wrapperPath, ['[sudo] password for someone:'], {
        env: { ...process.env, TAI_ASKPASS_KEY: 'tab_7' },
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      let stdout = '';
      child.stdout!.setEncoding('utf8');
      child.stdout!.on('data', (c: string) => { stdout += c; });
      child.on('close', (code) => resolve({ code, stdout, pid: child.pid! }));
    });
  }

  it('sends its own pid (exec keeps it), the key and the prompt', async () => {
    let received: any = null;
    await serve((line, sock) => { received = JSON.parse(line); sock.end('{"ok":false}\n'); });
    const r = await run();
    expect(received).toEqual({ pid: r.pid, key: 'tab_7', prompt: '[sudo] password for someone:' });
  });

  it('prints a returned secret and exits 0', async () => {
    await serve((_l, sock) => sock.end('{"ok":true,"secret":"hunter2"}\n'));
    expect(await run()).toMatchObject({ code: 0, stdout: 'hunter2\n' });
  });

  it('exits 1 and prints nothing when ok arrives without a secret', async () => {
    await serve((_l, sock) => sock.end('{"ok":true}\n'));
    expect(await run()).toMatchObject({ code: 1, stdout: '' });
  });

  it('exits 1 on refusal', async () => {
    await serve((_l, sock) => sock.end('{"ok":false}\n'));
    expect(await run()).toMatchObject({ code: 1, stdout: '' });
  });

  it('exits 1 when the broker hangs up without replying', async () => {
    await serve((_l, sock) => sock.destroy());
    expect(await run()).toMatchObject({ code: 1, stdout: '' });
  });

  it('exits 1 when no broker is listening', async () => {
    expect(await run()).toMatchObject({ code: 1, stdout: '' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config tests/vitest.config.ts tests/unit/askpassHelper.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// electron/services/askpassHelper.ts
import * as fs from 'fs';
import * as path from 'path';

/** Per-run directory name prefix under the temp dir. */
export const ASKPASS_DIR_PREFIX = 'tai-askpass-';
/** File inside that directory holding the owning TAI main-process pid. */
export const ASKPASS_OWNER_FILE = 'owner.pid';

/**
 * sudo takes SUDO_ASKPASS as a bare path with no arguments, so the helper is a
 * sh wrapper that execs TAI's own Electron binary as Node. `exec` keeps the pid,
 * which matters: the broker checks the parent of the pid the helper reports,
 * and that must be sudo, not an intermediate shell.
 */
export function generateAskpassWrapper(execPath: string, helperPath: string): string {
  return `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec ${shQuote(execPath)} ${shQuote(helperPath)} "$@"\n`;
}

function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * The helper is untrusted — the AI can read, run or rewrite it. It only reports
 * who it is and relays the broker's answer; every decision is in the broker.
 */
export function generateAskpassHelperScript(socketPath: string): string {
  return `'use strict';
const net = require('net');
const SOCKET = ${JSON.stringify(socketPath)};
let settled = false;
function exit(code) { if (!settled) { settled = true; process.exit(code); } }
const sock = net.createConnection(SOCKET);
sock.setEncoding('utf8');
sock.on('connect', () => {
  sock.write(JSON.stringify({
    pid: process.pid,
    key: process.env.TAI_ASKPASS_KEY || '',
    prompt: process.argv[2] || '',
  }) + '\\n');
});
let buf = '';
sock.on('data', (chunk) => {
  buf += chunk;
  const nl = buf.indexOf('\\n');
  if (nl < 0) return;
  let reply = null;
  try { reply = JSON.parse(buf.slice(0, nl)); } catch {}
  if (!reply || reply.ok !== true || typeof reply.secret !== 'string') return exit(1);
  settled = true;
  process.stdout.write(reply.secret + '\\n', () => process.exit(0));
});
sock.on('error', () => exit(1));
sock.on('close', () => exit(1));
`;
}

export function buildAskpassEnv(
  key: string,
  askpassPath: string | null,
  platform: NodeJS.Platform,
): Record<string, string> {
  if (!askpassPath || (platform !== 'linux' && platform !== 'darwin')) return {};
  return { SUDO_ASKPASS: askpassPath, TAI_ASKPASS_KEY: key };
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: the pid exists but belongs to someone else — treat as alive.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * A crashed run leaves its askpass directory behind. Remove ours whose owning
 * process is gone, but never one belonging to a live TAI (a dev build and the
 * packaged app can share a temp dir) or to another user.
 */
export function sweepStaleAskpassDirs(
  tempDir: string,
  isAlive: (pid: number) => boolean = pidAlive,
): string[] {
  const removed: string[] = [];
  let names: string[];
  try {
    names = fs.readdirSync(tempDir);
  } catch {
    return removed;
  }
  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  for (const name of names) {
    if (!name.startsWith(ASKPASS_DIR_PREFIX)) continue;
    const dir = path.join(tempDir, name);
    try {
      const st = fs.lstatSync(dir);
      if (!st.isDirectory() || (uid !== null && st.uid !== uid)) continue;
      let owner = Number.NaN;
      try {
        owner = Number.parseInt(fs.readFileSync(path.join(dir, ASKPASS_OWNER_FILE), 'utf8').trim(), 10);
      } catch { /* no owner file */ }
      if (Number.isInteger(owner) && owner > 0 && isAlive(owner)) continue;
      fs.rmSync(dir, { recursive: true, force: true });
      removed.push(name);
    } catch { /* best effort */ }
  }
  return removed;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config tests/vitest.config.ts tests/unit/askpassHelper.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add electron/services/askpassHelper.ts tests/unit/askpassHelper.test.ts
git commit -m "feat(askpass): generate the SUDO_ASKPASS helper and env

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: `AskpassBroker` — claims, tripwire, queue, decide, reply, cancel

**Files:**
- Create: `electron/services/askpassBroker.ts`
- Test: `tests/unit/askpassBroker.test.ts`

**Interfaces:**
- Consumes: `decideAskpass` (Task 3).
- Produces:
  - `const AUTOFILL_HOLD_MS = 150`
  - `interface AskpassRequest { pid: number; key: string; prompt: string }`
  - `interface AskpassReply { ok: boolean; secret?: string }`
  - `interface SecretStore { isSet(): boolean; get(): Buffer | null; set(secret: Buffer): void; clear(): void }` (satisfied by `credentialVault`)
  - `type SudoOutcome = 'answered' | 'cancelled' | 'refused-duplicate'`
  - `interface BrokerDeps { resolveSudoParent(pid): number | null; vault: SecretStore; send(channel: string, ...args: unknown[]): void; timeoutMs: number; autofillHoldMs?: number; setTimer(fn: () => void, ms: number): unknown; clearTimer(handle: unknown): void; newId?: () => string }`
  - `class AskpassBroker { handleRequest(req, reply: (r: AskpassReply) => void): () => void; answer(requestId: string, secret: string, remember: boolean): void; cancel(requestId: string): void; cancelKey(key: string): void; cancelAll(): void }`
- Renderer messages sent via `send('ai:message', key, msg)`:
  - `{ type: 'sudo_prompt', requestId: string, prompt: string }`
  - `{ type: 'sudo_resolved', requestId: string, outcome: SudoOutcome }`
  - `{ type: 'sudo_auth' }`
- Also sends `send('pty:secret-state', boolean)` (existing channel).
- Rules:
  - A verified request records a claim `pid → { sudoPid, requestId, key }`. It stays while pending and after an answer (single use); it is released when the request is cancelled or times out. A claim with a different `sudoPid` is a recycled pid and is replaced.
  - A request whose `pid` has a claim with the same `sudoPid` trips the wire: newcomer `{ ok: false }`; the claimed request, if still pending, `{ ok: false }`; `vault.clear()`; `pty:secret-state false`; `sudo_resolved` `refused-duplicate` (requestId of the original claim) to the original key and, if different, the newcomer's key. The claim stays burned.
  - `auto-fill` holds for `autofillHoldMs` (default `AUTOFILL_HOLD_MS`) before replying; the vault is re-read at the end of the hold and an empty vault falls through to a prompt.
  - Claims are capped at 1024; beyond that the oldest **settled** claim is dropped. A claim whose request is still pending is never evicted.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/askpassBroker.test.ts
import { describe, it, expect, vi } from 'vitest';
import {
  AskpassBroker, AUTOFILL_HOLD_MS, type BrokerDeps, type AskpassReply,
} from '../../electron/services/askpassBroker';

const SECRET = 'correct horse';

function makeVault(initial: string | null = null) {
  let s: Buffer | null = initial === null ? null : Buffer.from(initial);
  return {
    isSet: () => s !== null,
    get: vi.fn(() => s),
    set: vi.fn((b: Buffer) => { s = Buffer.from(b); }),
    clear: vi.fn(() => { s = null; }),
  };
}

function setup(opts: { vault?: ReturnType<typeof makeVault>; sudoPid?: (pid: number) => number | null } = {}) {
  let now = 0;
  const timers: Array<{ fn: () => void; due: number; cleared: boolean }> = [];
  const send = vi.fn();
  const vault = opts.vault ?? makeVault();
  let n = 0;
  const deps: BrokerDeps = {
    resolveSudoParent: opts.sudoPid ?? ((pid) => pid + 1000),
    vault,
    send,
    timeoutMs: 300_000,
    autofillHoldMs: AUTOFILL_HOLD_MS,
    setTimer: (fn, ms) => { const t = { fn, due: now + ms, cleared: false }; timers.push(t); return t; },
    clearTimer: (h) => { if (h) (h as { cleared: boolean }).cleared = true; },
    newId: () => `req-${++n}`,
  };
  const broker = new AskpassBroker(deps);
  const request = (pid: number, key = 'tab_1') => {
    const reply = vi.fn<(r: AskpassReply) => void>();
    const cancel = broker.handleRequest({ pid, key, prompt: '[sudo] password for me:' }, reply);
    return { reply, cancel };
  };
  /** Fake clock: move time forward and run every timer now due, in due order. */
  const advance = (ms: number) => {
    now += ms;
    for (;;) {
      const next = timers.filter((t) => !t.cleared && t.due <= now).sort((a, b) => a.due - b.due)[0];
      if (!next) return;
      next.cleared = true;
      next.fn();
    }
  };
  return { broker, deps, send, vault, request, advance, timers };
}

function messages(send: ReturnType<typeof vi.fn>, key = 'tab_1') {
  return send.mock.calls.filter((c) => c[0] === 'ai:message' && c[1] === key).map((c) => c[2]);
}

describe('AskpassBroker', () => {
  it('refuses immediately when the parent is not sudo, without touching the vault', () => {
    const vault = makeVault(SECRET);
    const { request, send } = setup({ vault, sudoPid: () => null });
    const { reply } = request(42);
    expect(reply).toHaveBeenCalledWith({ ok: false });
    expect(vault.get).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('prompts the renderer when nothing is cached', () => {
    const { request, send } = setup();
    const { reply } = request(42);
    expect(reply).not.toHaveBeenCalled();
    expect(messages(send)).toEqual([{ type: 'sudo_prompt', requestId: 'req-1', prompt: '[sudo] password for me:' }]);
  });

  it('returns an answer to the helper over the socket', () => {
    const { broker, request, send } = setup();
    const { reply } = request(42);
    broker.answer('req-1', SECRET, false);
    expect(reply).toHaveBeenCalledWith({ ok: true, secret: SECRET });
    expect(messages(send)).toContainEqual({ type: 'sudo_resolved', requestId: 'req-1', outcome: 'answered' });
  });

  it('remember stores the secret and broadcasts cache state', () => {
    const { broker, request, vault, send } = setup();
    request(42);
    broker.answer('req-1', SECRET, true);
    expect(vault.set).toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith('pty:secret-state', true);
  });

  it('auto-fills when cached only after the hold, flashes, and never shows a prompt', () => {
    const { request, send, advance } = setup({ vault: makeVault(SECRET) });
    const { reply } = request(42);
    advance(AUTOFILL_HOLD_MS - 1);
    expect(reply).not.toHaveBeenCalled();
    expect(messages(send)).toEqual([]);
    advance(1);
    expect(reply).toHaveBeenCalledWith({ ok: true, secret: SECRET });
    expect(messages(send)).toEqual([{ type: 'sudo_auth' }]);
  });

  it('prompts instead if the cache is cleared during the hold', () => {
    const vault = makeVault(SECRET);
    const { request, send, advance } = setup({ vault });
    const { reply } = request(42);
    vault.clear();
    advance(AUTOFILL_HOLD_MS);
    expect(reply).not.toHaveBeenCalled();
    expect(messages(send).at(-1)).toEqual({ type: 'sudo_prompt', requestId: 'req-1', prompt: '[sudo] password for me:' });
  });

  it('same sudo asking again after an auto-fill: clears cache and prompts', () => {
    const vault = makeVault(SECRET);
    const { request, send, advance } = setup({ vault, sudoPid: () => 900 });
    request(42);                 // auto-fill for sudo 900
    advance(AUTOFILL_HOLD_MS);
    const second = request(43);  // sudo 900 asks again → wrong secret
    advance(AUTOFILL_HOLD_MS);
    expect(second.reply).not.toHaveBeenCalled();
    expect(vault.clear).toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith('pty:secret-state', false);
    expect(messages(send).at(-1)).toEqual({ type: 'sudo_prompt', requestId: 'req-2', prompt: '[sudo] password for me:' });
  });

  it('a different sudo process after an auto-fill auto-fills again', () => {
    const { request, advance } = setup({ vault: makeVault(SECRET) });
    const a = request(42);  // sudo 1042
    advance(AUTOFILL_HOLD_MS);
    const b = request(43);  // sudo 1043
    advance(AUTOFILL_HOLD_MS);
    expect(a.reply).toHaveBeenCalledWith({ ok: true, secret: SECRET });
    expect(b.reply).toHaveBeenCalledWith({ ok: true, secret: SECRET });
  });

  it('a remembered answer followed by the same sudo re-asking is rejected, not replayed', () => {
    const vault = makeVault();
    const { broker, request, advance } = setup({ vault, sudoPid: () => 900 });
    request(42);
    broker.answer('req-1', 'typo', true);
    const second = request(43);
    advance(AUTOFILL_HOLD_MS);
    expect(second.reply).not.toHaveBeenCalled();
    expect(vault.clear).toHaveBeenCalled();
  });

  it('queues per key: shows one prompt at a time, remember drains the rest', () => {
    const { broker, request, send, advance } = setup();
    request(42);
    const b = request(43);
    expect(messages(send).filter((m) => m.type === 'sudo_prompt')).toHaveLength(1);
    broker.answer('req-1', SECRET, true);
    advance(AUTOFILL_HOLD_MS);
    expect(b.reply).toHaveBeenCalledWith({ ok: true, secret: SECRET });
    expect(messages(send).filter((m) => m.type === 'sudo_prompt')).toHaveLength(1);
  });

  it('without remember, the next queued request is prompted', () => {
    const { broker, request, send } = setup();
    request(42);
    request(43);
    broker.answer('req-1', SECRET, false);
    expect(messages(send).filter((m) => m.type === 'sudo_prompt').map((m) => m.requestId)).toEqual(['req-1', 'req-2']);
  });

  it('keys are independent', () => {
    const { request, send } = setup();
    request(42, 'tab_1');
    request(43, 'tab_2');
    expect(messages(send, 'tab_1')).toHaveLength(1);
    expect(messages(send, 'tab_2')).toHaveLength(1);
  });

  it('cancel replies not-ok and resolves the prompt', () => {
    const { broker, request, send } = setup();
    const { reply } = request(42);
    broker.cancel('req-1');
    expect(reply).toHaveBeenCalledWith({ ok: false });
    expect(messages(send)).toContainEqual({ type: 'sudo_resolved', requestId: 'req-1', outcome: 'cancelled' });
  });

  it('the returned canceller (socket closed) cancels', () => {
    const { request } = setup();
    const { reply, cancel } = request(42);
    cancel();
    expect(reply).toHaveBeenCalledWith({ ok: false });
  });

  it('timeout cancels', () => {
    const { request, advance } = setup();
    const { reply } = request(42);
    advance(300_000);
    expect(reply).toHaveBeenCalledWith({ ok: false });
  });

  it('cancelKey cancels only that key; cancelAll cancels everything', () => {
    const { broker, request } = setup();
    const a = request(42, 'tab_1');
    const b = request(43, 'tab_2');
    broker.cancelKey('tab_1');
    expect(a.reply).toHaveBeenCalledWith({ ok: false });
    expect(b.reply).not.toHaveBeenCalled();
    broker.cancelAll();
    expect(b.reply).toHaveBeenCalledWith({ ok: false });
  });

  it('answering an unknown or already-resolved request does nothing', () => {
    const { broker, request } = setup();
    const a = request(42);
    broker.cancel('req-1');
    broker.answer('req-1', SECRET, true);
    broker.answer('nope', SECRET, true);
    expect(a.reply).toHaveBeenCalledTimes(1);
    expect(a.reply).toHaveBeenCalledWith({ ok: false });
  });

  it('clears timers when a request resolves', () => {
    const { broker, request, timers } = setup();
    request(42);
    broker.answer('req-1', SECRET, false);
    expect(timers.every((t) => t.cleared)).toBe(true);
  });

  it('never puts the secret in anything sent to the renderer (auto-fill and answer paths)', () => {
    const vault = makeVault(SECRET);
    const { broker, request, send, advance } = setup({ vault });
    const filled = request(42);          // auto-fill path
    advance(AUTOFILL_HOLD_MS);
    expect(filled.reply).toHaveBeenCalledWith({ ok: true, secret: SECRET });
    vault.clear();
    const prompted = request(43);        // prompt + remembered answer path (req-2)
    broker.answer('req-2', SECRET, true);
    expect(prompted.reply).toHaveBeenCalledWith({ ok: true, secret: SECRET });
    expect(messages(send).map((m) => m.type)).toEqual(['sudo_auth', 'sudo_prompt', 'sudo_resolved']);
    expect(send).toHaveBeenCalledWith('pty:secret-state', true);
    expect(JSON.stringify(send.mock.calls)).not.toContain(SECRET);
  });

  it('the claim cap never evicts a claim that is still pending', () => {
    const { request } = setup();
    const first = request(2, 'tab_first');
    for (let pid = 3; pid < 3 + 1100; pid++) request(pid, `tab_${pid}`);
    const dup = request(2, 'tab_first');
    expect(dup.reply).toHaveBeenCalledWith({ ok: false });
    expect(first.reply).toHaveBeenCalledWith({ ok: false });
  });
});

describe('AskpassBroker single use and duplicate-claim tripwire', () => {
  const refused = (requestId: string) => ({ type: 'sudo_resolved', requestId, outcome: 'refused-duplicate' });

  it('an answered pid is never answered again, and the re-claim trips the wire', () => {
    const vault = makeVault();
    const { broker, request, send, advance } = setup({ vault });
    const first = request(42);
    broker.answer('req-1', SECRET, true);
    const again = request(42);
    advance(10 * AUTOFILL_HOLD_MS);
    expect(first.reply).toHaveBeenCalledTimes(1);
    expect(again.reply).toHaveBeenCalledTimes(1);
    expect(again.reply).toHaveBeenCalledWith({ ok: false });
    expect(vault.clear).toHaveBeenCalled();
    expect(vault.isSet()).toBe(false);
    expect(send).toHaveBeenLastCalledWith('ai:message', 'tab_1', refused('req-1'));
    expect(send).toHaveBeenCalledWith('pty:secret-state', false);
  });

  it('a duplicate while the prompt is shown refuses both and clears the vault', () => {
    const vault = makeVault();
    const { broker, request, send } = setup({ vault });
    const original = request(42);
    const dup = request(42);
    expect(original.reply).toHaveBeenCalledWith({ ok: false });
    expect(dup.reply).toHaveBeenCalledWith({ ok: false });
    expect(vault.clear).toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith('pty:secret-state', false);
    expect(messages(send)).toContainEqual(refused('req-1'));
    broker.answer('req-1', SECRET, false);
    expect(original.reply).toHaveBeenCalledTimes(1);
  });

  it('a duplicate during the auto-fill hold refuses both and the secret never goes out', () => {
    const vault = makeVault(SECRET);
    const { request, send, advance } = setup({ vault });
    const real = request(42);
    advance(AUTOFILL_HOLD_MS - 1);
    const spoof = request(42);
    advance(10 * AUTOFILL_HOLD_MS);
    expect(real.reply).toHaveBeenCalledWith({ ok: false });
    expect(spoof.reply).toHaveBeenCalledWith({ ok: false });
    expect(JSON.stringify([...real.reply.mock.calls, ...spoof.reply.mock.calls])).not.toContain(SECRET);
    expect(vault.isSet()).toBe(false);
    expect(messages(send)).not.toContainEqual({ type: 'sudo_auth' });
    expect(messages(send)).toContainEqual(refused('req-1'));
  });

  it('further claims on a tripped pid keep tripping', () => {
    const vault = makeVault(SECRET);
    const { request, advance } = setup({ vault });
    request(42);
    request(42);
    vault.set(Buffer.from(SECRET));
    const third = request(42);
    advance(10 * AUTOFILL_HOLD_MS);
    expect(third.reply).toHaveBeenCalledWith({ ok: false });
    expect(vault.isSet()).toBe(false);
  });

  it('a cancelled request releases its claim', () => {
    const { broker, request, send, vault } = setup();
    request(42);
    broker.cancel('req-1');
    const retry = request(42);
    expect(retry.reply).not.toHaveBeenCalled();
    expect(vault.clear).not.toHaveBeenCalled();
    expect(messages(send).at(-1)).toEqual({ type: 'sudo_prompt', requestId: 'req-2', prompt: '[sudo] password for me:' });
  });

  it('a recycled pid under a different sudo is not a duplicate', () => {
    let parent = 900;
    const { broker, request, send, vault } = setup({ sudoPid: () => parent });
    request(42);
    broker.answer('req-1', SECRET, false);
    parent = 901;
    const next = request(42);
    expect(next.reply).not.toHaveBeenCalled();
    expect(vault.clear).not.toHaveBeenCalled();
    expect(messages(send).at(-1)).toEqual({ type: 'sudo_prompt', requestId: 'req-2', prompt: '[sudo] password for me:' });
  });

  it('a duplicate claimed from another key warns both keys', () => {
    const { request, send } = setup();
    request(42, 'tab_1');
    request(42, 'tab_2');
    expect(messages(send, 'tab_1')).toContainEqual(refused('req-1'));
    expect(messages(send, 'tab_2')).toEqual([refused('req-1')]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config tests/vitest.config.ts tests/unit/askpassBroker.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// electron/services/askpassBroker.ts
import { randomUUID } from 'crypto';
import { decideAskpass } from './askpassDecision';

/**
 * How long an auto-fill waits before replying. A client spoofing a helper's pid
 * must connect before or alongside the real helper, so a duplicate claim that
 * lands inside this window trips the wire instead of racing the secret out.
 */
export const AUTOFILL_HOLD_MS = 150;

/** Claims kept for single-use checks; the oldest settled ones are dropped beyond this. */
const MAX_CLAIMS = 1024;

export interface AskpassRequest {
  pid: number;
  key: string;
  prompt: string;
}

export interface AskpassReply {
  ok: boolean;
  secret?: string;
}

export interface SecretStore {
  isSet(): boolean;
  get(): Buffer | null;
  set(secret: Buffer): void;
  clear(): void;
}

export type SudoOutcome = 'answered' | 'cancelled' | 'refused-duplicate';

export interface BrokerDeps {
  resolveSudoParent(pid: number): number | null;
  vault: SecretStore;
  send(channel: string, ...args: unknown[]): void;
  timeoutMs: number;
  autofillHoldMs?: number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  newId?: () => string;
}

interface Pending {
  id: string;
  key: string;
  pid: number;
  sudoPid: number;
  prompt: string;
  reply: (r: AskpassReply) => void;
  timer: unknown;
  holdTimer: unknown;
  state: 'queued' | 'holding' | 'shown';
}

interface Claim {
  sudoPid: number;
  requestId: string;
  key: string;
}

/**
 * Answers sudo askpass requests from AI tool processes. The secret goes back
 * over the socket, so the only thing standing between it and a lying client is
 * the parent check plus two rules: each helper pid is answered at most once,
 * and any second claim on a pid refuses both claimants and clears the cache.
 * One prompt is visible (or one auto-fill holding) per key at a time; the rest
 * wait in arrival order.
 */
export class AskpassBroker {
  private pending: Pending[] = [];
  private lastFilled = new Map<string, number>();
  /** Helper pid → the request that claimed it: pending, answered, or burned by a duplicate. */
  private claims = new Map<number, Claim>();

  constructor(private readonly deps: BrokerDeps) {}

  /** Returns a canceller for when the helper's connection drops. */
  handleRequest(req: AskpassRequest, reply: (r: AskpassReply) => void): () => void {
    const sudoPid = this.deps.resolveSudoParent(req.pid);
    if (decideAskpass({ sudoPid, vaultSet: false, lastFilledSudoPid: null }) === 'refuse') {
      reply({ ok: false });
      return () => {};
    }

    const prior = this.claims.get(req.pid);
    // A different sudo parent means the old helper is gone and the pid was
    // recycled; a spoofer claiming a live helper's pid resolves the same sudo.
    if (prior && prior.sudoPid === sudoPid) {
      this.tripDuplicate(prior, req.key, reply);
      return () => {};
    }

    const id = (this.deps.newId ?? randomUUID)();
    const p: Pending = {
      id, key: req.key, pid: req.pid, sudoPid: sudoPid!, prompt: req.prompt, reply,
      timer: null, holdTimer: null, state: 'queued',
    };
    p.timer = this.deps.setTimer(() => this.cancel(id), this.deps.timeoutMs);
    this.pending.push(p);
    // Claim after pushing, so the cap sees this request as pending.
    this.claim(req.pid, { sudoPid: sudoPid!, requestId: id, key: req.key });
    this.pump(req.key);
    return () => this.cancel(id);
  }

  answer(requestId: string, secret: string, remember: boolean): void {
    const p = this.pending.find((x) => x.id === requestId && x.state === 'shown');
    if (!p || typeof secret !== 'string') return;
    if (remember && secret.length > 0) {
      this.deps.vault.set(Buffer.from(secret, 'utf8'));
      // Treat a remembered answer like a fill: if this same sudo asks again the
      // secret was wrong, and it must not be replayed from the cache.
      this.lastFilled.set(p.key, p.sudoPid);
      this.deps.send('pty:secret-state', true);
    }
    this.remove(p);
    p.reply({ ok: true, secret });
    this.deps.send('ai:message', p.key, { type: 'sudo_resolved', requestId: p.id, outcome: 'answered' satisfies SudoOutcome });
    this.pump(p.key);
  }

  cancel(requestId: string): void {
    const p = this.pending.find((x) => x.id === requestId);
    if (!p) return;
    this.dismiss(p);
    this.pump(p.key);
  }

  cancelKey(key: string): void {
    for (const p of this.pending.filter((x) => x.key === key)) this.dismiss(p);
  }

  cancelAll(): void {
    for (const p of [...this.pending]) this.dismiss(p);
  }

  private claim(pid: number, c: Claim): void {
    this.claims.delete(pid);
    this.claims.set(pid, c);
    if (this.claims.size <= MAX_CLAIMS) return;
    // Drop the oldest settled claim. A pending claim must stay, or a second
    // claim on its pid would slip past the tripwire.
    const pendingIds = new Set(this.pending.map((x) => x.id));
    for (const [oldPid, old] of this.claims) {
      if (oldPid !== pid && !pendingIds.has(old.requestId)) {
        this.claims.delete(oldPid);
        return;
      }
    }
  }

  /**
   * Two clients claim one helper pid: one of them is impersonating a helper.
   * We cannot tell which, so neither gets anything, the cached secret is
   * dropped, and the user is told. The claim stays burned.
   */
  private tripDuplicate(prior: Claim, newcomerKey: string, reply: (r: AskpassReply) => void): void {
    reply({ ok: false });
    const p = this.pending.find((x) => x.id === prior.requestId);
    if (p) {
      this.remove(p);
      p.reply({ ok: false });
    }
    this.deps.vault.clear();
    this.lastFilled.delete(prior.key);
    this.deps.send('pty:secret-state', false);
    const notice = { type: 'sudo_resolved', requestId: prior.requestId, outcome: 'refused-duplicate' satisfies SudoOutcome };
    this.deps.send('ai:message', prior.key, notice);
    if (newcomerKey !== prior.key) this.deps.send('ai:message', newcomerKey, notice);
    if (p) this.pump(prior.key);
  }

  private dismiss(p: Pending): void {
    this.remove(p);
    // Never answered, so the pid is free again (single use counts answers).
    if (this.claims.get(p.pid)?.requestId === p.id) this.claims.delete(p.pid);
    p.reply({ ok: false });
    if (p.state === 'shown') {
      this.deps.send('ai:message', p.key, { type: 'sudo_resolved', requestId: p.id, outcome: 'cancelled' satisfies SudoOutcome });
    }
  }

  private remove(p: Pending): void {
    this.pending = this.pending.filter((x) => x !== p);
    this.deps.clearTimer(p.timer);
    if (p.holdTimer !== null) {
      this.deps.clearTimer(p.holdTimer);
      p.holdTimer = null;
    }
  }

  private finishAutofill(id: string): void {
    const p = this.pending.find((x) => x.id === id && x.state === 'holding');
    if (!p) return;
    p.holdTimer = null;
    const secret = this.deps.vault.get();
    if (!secret) {
      // Cache cleared during the hold (forgotten, or a reject): ask instead.
      p.state = 'queued';
      this.pump(p.key);
      return;
    }
    this.lastFilled.set(p.key, p.sudoPid);
    this.remove(p);
    p.reply({ ok: true, secret: secret.toString('utf8') });
    this.deps.send('ai:message', p.key, { type: 'sudo_auth' });
    this.pump(p.key);
  }

  private pump(key: string): void {
    const head = this.pending.find((x) => x.key === key);
    if (!head || head.state !== 'queued') return;

    const decision = decideAskpass({
      sudoPid: head.sudoPid,
      vaultSet: this.deps.vault.isSet(),
      lastFilledSudoPid: this.lastFilled.get(key) ?? null,
    });

    if (decision === 'auto-fill') {
      head.state = 'holding';
      head.holdTimer = this.deps.setTimer(
        () => this.finishAutofill(head.id),
        this.deps.autofillHoldMs ?? AUTOFILL_HOLD_MS,
      );
      return;
    }

    if (decision === 'reject') {
      this.deps.vault.clear();
      this.lastFilled.delete(key);
      this.deps.send('pty:secret-state', false);
    }

    head.state = 'shown';
    this.deps.send('ai:message', key, { type: 'sudo_prompt', requestId: head.id, prompt: head.prompt });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config tests/vitest.config.ts tests/unit/askpassBroker.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add electron/services/askpassBroker.ts tests/unit/askpassBroker.test.ts
git commit -m "feat(askpass): broker with single-use pids, duplicate tripwire and auto-fill hold

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Socket server + real-process security tests

**Files:**
- Create: `electron/services/askpassServer.ts`
- Test: `tests/unit/askpassServer.test.ts`

**Interfaces:**
- Consumes: `AskpassBroker`, `AskpassRequest`, `AskpassReply` (Task 5); `generateAskpassHelperScript`, `generateAskpassWrapper` (Task 4); `resolveSudoParent` (Task 2).
- Produces:
  - `parseAskpassRequest(value: unknown): AskpassRequest | null` — `null` (→ refuse) for a non-integer pid ≤ 1, a non-string, empty or over-200-char key
  - `startAskpassServer(broker: Pick<AskpassBroker, 'handleRequest'>, socketPath: string): Promise<net.Server>`
- The server is platform-agnostic: it relays the broker's `AskpassReply` (including `secret` on success) as one JSON line, identically on Linux and macOS.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/askpassServer.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import { parseAskpassRequest, startAskpassServer } from '../../electron/services/askpassServer';
import { AskpassBroker } from '../../electron/services/askpassBroker';
import { resolveSudoParent } from '../../electron/services/sudoParent';
import { generateAskpassHelperScript, generateAskpassWrapper } from '../../electron/services/askpassHelper';

describe('parseAskpassRequest', () => {
  it('accepts a well-formed request', () => {
    expect(parseAskpassRequest({ pid: 42, key: 'tab_1', prompt: 'p' })).toEqual({ pid: 42, key: 'tab_1', prompt: 'p' });
  });

  it('rejects bad shapes', () => {
    expect(parseAskpassRequest(null)).toBeNull();
    expect(parseAskpassRequest({ pid: '42', key: 'k', prompt: '' })).toBeNull();
    expect(parseAskpassRequest({ pid: 1, key: 'k', prompt: '' })).toBeNull();
    expect(parseAskpassRequest({ pid: 42.5, key: 'k', prompt: '' })).toBeNull();
    expect(parseAskpassRequest({ pid: 42, key: 7, prompt: '' })).toBeNull();
    expect(parseAskpassRequest({ pid: 42, key: '', prompt: '' })).toBeNull();
    expect(parseAskpassRequest({ pid: 42, key: 'x'.repeat(201), prompt: '' })).toBeNull();
  });

  it('truncates a long prompt and defaults a missing one', () => {
    expect(parseAskpassRequest({ pid: 42, key: 'k', prompt: 'x'.repeat(1000) })!.prompt).toHaveLength(500);
    expect(parseAskpassRequest({ pid: 42, key: 'k' })!.prompt).toBe('');
  });
});

describe.skipIf(process.platform === 'win32')('askpass server (real sockets and processes)', () => {
  let dir: string;
  let socketPath: string;
  let wrapperPath: string;
  let server: net.Server | null = null;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tai-askpass-srv-'));
    socketPath = path.join(dir, 'broker.sock');
    const helperPath = path.join(dir, 'askpass.cjs');
    fs.writeFileSync(helperPath, generateAskpassHelperScript(socketPath), { mode: 0o700 });
    wrapperPath = path.join(dir, 'askpass');
    fs.writeFileSync(wrapperPath, generateAskpassWrapper(process.execPath, helperPath), { mode: 0o700 });
  });

  afterEach(async () => {
    if (server) await new Promise<void>((r) => server!.close(() => r()));
    server = null;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function runHelper(): Promise<{ code: number | null; stdout: string }> {
    return new Promise((resolve) => {
      const child = spawn(wrapperPath, ['[sudo] password:'], {
        env: { ...process.env, TAI_ASKPASS_KEY: 'tab_1' },
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      let stdout = '';
      child.stdout!.setEncoding('utf8');
      child.stdout!.on('data', (c: string) => { stdout += c; });
      child.on('close', (code) => resolve({ code, stdout }));
    });
  }

  it('SECURITY: a helper not spawned by sudo gets nothing, even with a cached secret', async () => {
    const SECRET = 'do-not-leak';
    const vault = {
      isSet: () => true,
      get: vi.fn(() => Buffer.from(SECRET)),
      set: vi.fn(),
      clear: vi.fn(),
    };
    const send = vi.fn();
    const broker = new AskpassBroker({
      resolveSudoParent,            // the real check; our parent is vitest, not sudo
      vault,
      send,
      timeoutMs: 5_000,
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h as NodeJS.Timeout),
    });
    server = await startAskpassServer(broker, socketPath);

    const r = await runHelper();

    expect(r).toEqual({ code: 1, stdout: '' });
    expect(vault.get).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('delivers a verified auto-fill end-to-end over the socket', async () => {
    const SECRET = 'e2e-secret';
    const vault = {
      isSet: () => true,
      get: vi.fn(() => Buffer.from(SECRET)),
      set: vi.fn(),
      clear: vi.fn(),
    };
    const send = vi.fn();
    const broker = new AskpassBroker({
      resolveSudoParent: () => 4100,  // stand-in for a verified sudo parent
      vault,
      send,
      timeoutMs: 5_000,
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h as NodeJS.Timeout),
    });
    server = await startAskpassServer(broker, socketPath);

    expect(await runHelper()).toEqual({ code: 0, stdout: `${SECRET}\n` });
    expect(send).toHaveBeenCalledWith('ai:message', 'tab_1', { type: 'sudo_auth' });
    expect(JSON.stringify(send.mock.calls)).not.toContain(SECRET);
  });

  it('relays a broker reply to the helper', async () => {
    server = await startAskpassServer(
      { handleRequest: (_req, reply) => { reply({ ok: true, secret: 's3cret' }); return () => {}; } },
      socketPath,
    );
    expect(await runHelper()).toEqual({ code: 0, stdout: 's3cret\n' });
  });

  it('cancels the request when the helper disconnects before a reply', async () => {
    const cancel = vi.fn();
    server = await startAskpassServer({ handleRequest: () => cancel }, socketPath);
    const sock = net.createConnection(socketPath);
    await new Promise<void>((r) => sock.on('connect', () => r()));
    sock.write(JSON.stringify({ pid: 4242, key: 'tab_1', prompt: '' }) + '\n');
    await new Promise((r) => setTimeout(r, 50));
    sock.destroy();
    await vi.waitFor(() => expect(cancel).toHaveBeenCalled());
  });

  it('refuses malformed input without calling the broker', async () => {
    const handleRequest = vi.fn();
    server = await startAskpassServer({ handleRequest }, socketPath);
    const reply = await new Promise<string>((resolve) => {
      const sock = net.createConnection(socketPath);
      let buf = '';
      sock.setEncoding('utf8');
      sock.on('data', (c: string) => { buf += c; });
      sock.on('close', () => resolve(buf));
      sock.on('connect', () => sock.write('not json\n'));
    });
    expect(reply).toBe('{"ok":false}\n');
    expect(handleRequest).not.toHaveBeenCalled();
  });

  it('restricts the socket file to the owner', async () => {
    server = await startAskpassServer({ handleRequest: () => () => {} }, socketPath);
    expect(fs.statSync(socketPath).mode & 0o077).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config tests/vitest.config.ts tests/unit/askpassServer.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// electron/services/askpassServer.ts
import * as fs from 'fs';
import * as net from 'net';
import type { AskpassBroker, AskpassRequest } from './askpassBroker';

const MAX_LINE = 4096;
const MAX_KEY = 200;
const MAX_PROMPT = 500;

export function parseAskpassRequest(value: unknown): AskpassRequest | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.pid !== 'number' || !Number.isInteger(v.pid) || v.pid <= 1) return null;
  // An empty key (helper run without TAI_ASKPASS_KEY) routes to no tab: refuse
  // now rather than leave sudo waiting out the prompt timeout.
  if (typeof v.key !== 'string' || v.key.length === 0 || v.key.length > MAX_KEY) return null;
  const prompt = typeof v.prompt === 'string' ? v.prompt.slice(0, MAX_PROMPT) : '';
  return { pid: v.pid, key: v.key, prompt };
}

const REFUSE = '{"ok":false}\n';

export function startAskpassServer(
  broker: Pick<AskpassBroker, 'handleRequest'>,
  socketPath: string,
): Promise<net.Server> {
  try { fs.unlinkSync(socketPath); } catch { /* not there */ }

  const server = net.createServer((sock) => {
    let buf = '';
    let received = false;
    let replied = false;
    let cancel: (() => void) | null = null;

    sock.setEncoding('utf8');
    sock.on('data', (chunk: string) => {
      if (received) return;
      buf += chunk;
      if (buf.length > MAX_LINE) { sock.destroy(); return; }
      const nl = buf.indexOf('\n');
      if (nl < 0) return;
      received = true;

      let parsed: unknown = null;
      try { parsed = JSON.parse(buf.slice(0, nl)); } catch { /* malformed */ }
      const req = parseAskpassRequest(parsed);
      if (!req) { replied = true; sock.end(REFUSE); return; }

      cancel = broker.handleRequest(req, (reply) => {
        replied = true;
        if (!sock.destroyed) sock.end(JSON.stringify(reply) + '\n');
      });
    });
    sock.on('close', () => { if (!replied) cancel?.(); });
    sock.on('error', () => { /* close follows */ });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => {
      server.off('error', reject);
      // Keep a listener so a later server error cannot crash the main process.
      // Log the message only: requests and replies never reach this path.
      server.on('error', (err) => { console.warn('[askpass] server error:', err.message); });
      try { fs.chmodSync(socketPath, 0o600); } catch { /* dir is 0700 anyway */ }
      resolve(server);
    });
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config tests/vitest.config.ts tests/unit/askpassServer.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add electron/services/askpassServer.ts tests/unit/askpassServer.test.ts
git commit -m "feat(askpass): unix socket server with real-process refusal and delivery tests

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Main-process wiring — service, env injection, cancel hooks, IPC

**Files:**
- Create: `electron/services/askpassService.ts`
- Modify: `electron/main.ts` (imports; `app.whenReady().then(() => {` made async and awaiting the service right after `purgeStaleTempFiles(os.tmpdir());`, before the window and AI services exist; `before-quit`)
- Modify: `electron/services/claude.ts` (`env: enrichedEnv(),` inside `query({ options })`; `ai:cancel`, `ai:stop` handlers)
- Modify: `electron/services/codex.ts` (`const env = enrichedEnv();` in `codex:send`; `codex:stop` handler)
- Modify: `electron/services/gemini.ts` (`env: enrichedEnv(),` in `ensureTransport`; `gemini:stop` handler)
- Modify: `electron/preload.ts` (inside `ai: {`)
- Modify: `src/types/window.d.ts` (inside `ai: {`)
- Test: `tests/unit/askpassService.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2, 4, 5, 6; `credentialVault` from `./credentialVault`.
- Produces:
  - `setupAskpassService(getWindow: () => BrowserWindow | null): Promise<void>` — never rejects (failures are logged and leave the service off); uses `app.getPath('temp')`, sweeps stale `tai-askpass-*` dirs first, writes `owner.pid`
  - `askpassEnvFor(key: string): Record<string, string>`
  - `cancelAskpassForKey(key: string): void`
  - `stopAskpassService(): void`
  - IPC (renderer → main): `ai:sudo-answer (requestId: string, secret: string, remember: boolean)`, `ai:sudo-cancel (requestId: string)`
  - Preload: `window.tai.ai.sudoAnswer(requestId, secret, remember): void`, `window.tai.ai.sudoCancel(requestId): void`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/askpassService.test.ts
import { describe, it, expect } from 'vitest';
import { askpassEnvFor, cancelAskpassForKey, stopAskpassService } from '../../electron/services/askpassService';

describe('askpassService before setup', () => {
  it('provides no env and tolerates cancel/stop', () => {
    expect(askpassEnvFor('tab_1')).toEqual({});
    expect(() => cancelAskpassForKey('tab_1')).not.toThrow();
    expect(() => stopAskpassService()).not.toThrow();
  });

  it('never leaks the askpass vars into process.env, which terminal PTYs inherit', () => {
    // pty.ts builds each shell's env from `{ ...process.env }`, so keeping
    // process.env clean is what keeps the terminal unaffected.
    // Compare against the starting values: the suite may itself run under a
    // TAI AI tool, whose env legitimately carries both vars.
    const before = { SUDO_ASKPASS: process.env.SUDO_ASKPASS, TAI_ASKPASS_KEY: process.env.TAI_ASKPASS_KEY };
    askpassEnvFor('tab_1');
    cancelAskpassForKey('tab_1');
    expect({ SUDO_ASKPASS: process.env.SUDO_ASKPASS, TAI_ASKPASS_KEY: process.env.TAI_ASKPASS_KEY }).toEqual(before);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config tests/vitest.config.ts tests/unit/askpassService.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the service**

```ts
// electron/services/askpassService.ts
import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';
import { app, ipcMain, type BrowserWindow } from 'electron';
import { AskpassBroker } from './askpassBroker';
import { startAskpassServer } from './askpassServer';
import {
  ASKPASS_DIR_PREFIX, ASKPASS_OWNER_FILE, buildAskpassEnv, generateAskpassHelperScript,
  generateAskpassWrapper, sweepStaleAskpassDirs,
} from './askpassHelper';
import { resolveSudoParent } from './sudoParent';
import { credentialVault } from './credentialVault';

const PROMPT_TIMEOUT_MS = 5 * 60_000;

let broker: AskpassBroker | null = null;
let server: net.Server | null = null;
let dir: string | null = null;
let askpassPath: string | null = null;

/**
 * Routes sudo from AI tool processes (no tty → $SUDO_ASKPASS) to TAI's own
 * password field and session cache. Linux and macOS only: Windows sudo has no
 * askpass mechanism. The secret is returned over the private socket on both
 * platforms. If anything fails to start, AI sudo behaves as before.
 */
export async function setupAskpassService(getWindow: () => BrowserWindow | null): Promise<void> {
  if (process.platform !== 'linux' && process.platform !== 'darwin') return;

  const send = (channel: string, ...args: unknown[]) => {
    const win = getWindow();
    try {
      if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
    } catch { /* window gone */ }
  };

  broker = new AskpassBroker({
    resolveSudoParent: (pid) => resolveSudoParent(pid),
    vault: credentialVault,
    send,
    timeoutMs: PROMPT_TIMEOUT_MS,
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h as NodeJS.Timeout),
  });

  ipcMain.on('ai:sudo-answer', (_event, requestId: unknown, secret: unknown, remember: unknown) => {
    if (typeof requestId !== 'string' || typeof secret !== 'string') return;
    broker?.answer(requestId, secret, remember === true);
  });
  ipcMain.on('ai:sudo-cancel', (_event, requestId: unknown) => {
    if (typeof requestId === 'string') broker?.cancel(requestId);
  });

  try {
    const tempDir = app.getPath('temp');
    sweepStaleAskpassDirs(tempDir);
    dir = fs.mkdtempSync(path.join(tempDir, ASKPASS_DIR_PREFIX));
    fs.chmodSync(dir, 0o700);
    fs.writeFileSync(path.join(dir, ASKPASS_OWNER_FILE), String(process.pid), { mode: 0o600 });
    const socketPath = path.join(dir, 'broker.sock');
    const helperPath = path.join(dir, 'askpass.cjs');
    fs.writeFileSync(helperPath, generateAskpassHelperScript(socketPath), { mode: 0o700 });
    const wrapperPath = path.join(dir, 'askpass');
    fs.writeFileSync(wrapperPath, generateAskpassWrapper(process.execPath, helperPath), { mode: 0o700 });
    server = await startAskpassServer(broker, socketPath);
    askpassPath = wrapperPath;
  } catch (err) {
    console.warn('[askpass] unavailable:', err instanceof Error ? err.message : String(err));
    stopAskpassService();
  }
}

export function askpassEnvFor(key: string): Record<string, string> {
  return buildAskpassEnv(key, askpassPath, process.platform);
}

export function cancelAskpassForKey(key: string): void {
  broker?.cancelKey(key);
}

export function stopAskpassService(): void {
  askpassPath = null;
  broker?.cancelAll();
  try { server?.close(); } catch { /* already closed */ }
  server = null;
  if (dir) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
    dir = null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config tests/vitest.config.ts tests/unit/askpassService.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire `main.ts`**

Add import next to the other service imports:
```ts
import { setupAskpassService, stopAskpassService } from './services/askpassService';
```
Make the ready callback async — replace the line `app.whenReady().then(() => {` with:
```ts
app.whenReady().then(async () => {
```
and directly after `purgeStaleTempFiles(os.tmpdir());` (inside that callback, after the `gotInstanceLock` guard) add:
```ts
  // Before the window and the AI services exist, so no provider can spawn
  // without SUDO_ASKPASS. Never rejects; on failure AI sudo behaves as before.
  await setupAskpassService(() => mainWindow);
```
(`mainWindow` is read lazily by the getter, so it being `null` here is fine.)
In `app.on('before-quit', ...)`, directly after `credentialVault.clear();`:
```ts
  stopAskpassService();
```

- [ ] **Step 6: Merge env and cancel at the three AI services**

`electron/services/claude.ts` — add import:
```ts
import { askpassEnvFor, cancelAskpassForKey } from './askpassService';
```
In `startQuery`'s `query({ options: { ... } })` replace `env: enrichedEnv(),` with:
```ts
        env: { ...enrichedEnv(), ...askpassEnvFor(key) },
```
In both `ipcMain.on('ai:cancel', (_event, key: string) => {` and `ipcMain.on('ai:stop', (_event, key: string) => {`, make the first statement of the handler body:
```ts
    cancelAskpassForKey(key);
```

`electron/services/codex.ts` — add import:
```ts
import { askpassEnvFor, cancelAskpassForKey } from './askpassService';
```
In `codex:send` replace `const env = enrichedEnv();` with:
```ts
    const env = { ...enrichedEnv(), ...askpassEnvFor(key) };
```
First statement inside `ipcMain.on('codex:stop', (_event, key: string) => {`:
```ts
    cancelAskpassForKey(key);
```

`electron/services/gemini.ts` — add import:
```ts
import { askpassEnvFor, cancelAskpassForKey } from './askpassService';
```
In `ensureTransport` replace `env: enrichedEnv(),` with:
```ts
    env: { ...enrichedEnv(), ...askpassEnvFor(key) },
```
First statement inside `ipcMain.on('gemini:stop', async (_event, key: string) => {`:
```ts
    cancelAskpassForKey(key);
```

- [ ] **Step 7: Expose IPC to the renderer**

`electron/preload.ts`, inside `ai: {`, directly after the line `      ipcRenderer.invoke('ai:approve', key, toolUseId, approved, updatedInput),` (the second line of the `ai.approve` entry; the later `approve:` entries in other blocks are not the anchor):
```ts
    sudoAnswer: (requestId: string, secret: string, remember: boolean) =>
      ipcRenderer.send('ai:sudo-answer', requestId, secret, remember),
    sudoCancel: (requestId: string) => ipcRenderer.send('ai:sudo-cancel', requestId),
```
`src/types/window.d.ts`, inside `ai: {`, directly after the line `approve: (key: string, toolUseId: string, approved: boolean, updatedInput?: Record<string, unknown> | null) => Promise<boolean>;` (the only `approve:` with `updatedInput`):
```ts
        sudoAnswer?: (requestId: string, secret: string, remember: boolean) => void;
        sudoCancel?: (requestId: string) => void;
```

- [ ] **Step 8: Typecheck and run the full suite**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit 0.

Run: `npx tsc --noEmit -p tsconfig.node.json 2>&1 | grep 'error TS' | grep -v TS6307`
Expected: only the two pre-existing lines listed in Global Constraints.

Run: `npm test`
Expected: all test files pass.

- [ ] **Step 9: Commit**

```bash
git add electron/services/askpassService.ts tests/unit/askpassService.test.ts electron/main.ts \
  electron/services/claude.ts electron/services/codex.ts electron/services/gemini.ts \
  electron/preload.ts src/types/window.d.ts
git commit -m "feat(askpass): route AI provider sudo through the askpass broker

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Renderer — password field in the AI block and tab attention marker

**Files:**
- Create: `src/components/PasswordField.tsx`
- Modify: `src/components/PasswordPrompt.tsx` (full replacement below)
- Create: `src/components/SudoPrompt.tsx`
- Create: `src/utils/sudoDisplay.ts`
- Modify: `src/components/BlockList.tsx` (`DisplayItem` union at lines 21-24; render branch before `if (item.type === 'approval')`; import)
- Modify: `src/components/BlockList.module.css` (append)
- Modify: `src/components/TerminalSession.tsx` (props interface; destructuring; import; the always-on `window.tai?.ai?.onMessage(tabId, …)` effect at ~356-372; `aiNeedsInput` + its effect directly before the `visible` focus effect at ~416-420; that effect; the per-turn handler before `if (msg.type === 'approval_needed')` at ~1102; `handleStopAI` at ~1307; the window-`focus` effect at ~1499-1506; the `surface` focus effect at ~1578-1590)
- Modify: `src/types.ts` (`TabState`)
- Modify: `src/App.tsx` (handler beside `handleAiWorkingChange`; prop beside `onAiWorkingChange` at ~280)
- Modify: `src/components/TabSidebar.tsx` (beside the `workingDot` span at ~169) and `src/components/TabSidebar.module.css` (append)
- Test: `tests/unit/PasswordField.test.tsx`, `tests/unit/SudoPrompt.test.tsx`, `tests/unit/sudoDisplay.test.ts`

**Interfaces:**
- Consumes: `window.tai.ai.sudoAnswer`, `window.tai.ai.sudoCancel` (Task 7); `ai:message` types `sudo_prompt`, `sudo_resolved` (`outcome: SudoOutcome` = `'answered' | 'cancelled' | 'refused-duplicate'`), `sudo_auth` (Task 5).
- Produces:
  - `PasswordField(props: { onChar?: (c: string) => void; onBackspace?: () => void; onSubmit: (secret: string, remember: boolean) => void; onCancel: () => void; cancelOnEscape?: boolean })`
  - `SudoPrompt(props: { requestId: string; prompt: string })`
  - `DisplayItem` member `{ type: 'sudo'; id: string; requestId: string; prompt: string; status: 'pending' | 'answered' | 'cancelled' | 'auto' | 'refused' }`
  - `hasPendingSudo(items: DisplayItem[]): boolean`
  - `applySudoResolved(items: DisplayItem[], requestId: string, outcome: unknown, newId: () => string): DisplayItem[]` — marks the pending item for `requestId`; for `'refused-duplicate'` with no pending item (the request was queued, holding or already answered) it appends a `refused` warning item
  - `cancelPendingSudo(items: DisplayItem[]): DisplayItem[]` — marks every pending sudo item `cancelled`; returns `items` unchanged (same reference) when none is pending
  - `TabState.aiNeedsInput?: boolean`; `TerminalSessionProps.onAiNeedsInputChange?: (needsInput: boolean) => void`

- [ ] **Step 1: Write the failing tests**

```tsx
// tests/unit/PasswordField.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { PasswordField } from '../../src/components/PasswordField';

afterEach(() => cleanup());

function field() {
  return screen.getByTestId('password-field');
}

describe('PasswordField', () => {
  it('reports each char and submits the accumulated secret', () => {
    const onChar = vi.fn();
    const onSubmit = vi.fn();
    render(<PasswordField onChar={onChar} onSubmit={onSubmit} onCancel={() => {}} />);
    for (const k of ['a', 'b', 'c']) fireEvent.keyDown(field(), { key: k });
    fireEvent.keyDown(field(), { key: 'Backspace' });
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(onChar.mock.calls.map((c) => c[0])).toEqual(['a', 'b', 'c']);
    expect(onSubmit).toHaveBeenCalledWith('ab', false);
  });

  it('does not report backspace on an empty field', () => {
    const onBackspace = vi.fn();
    render(<PasswordField onBackspace={onBackspace} onSubmit={() => {}} onCancel={() => {}} />);
    fireEvent.keyDown(field(), { key: 'Backspace' });
    expect(onBackspace).not.toHaveBeenCalled();
  });

  it('passes the remember toggle through', () => {
    const onSubmit = vi.fn();
    render(<PasswordField onSubmit={onSubmit} onCancel={() => {}} />);
    fireEvent.click(screen.getByText('Remember for this session'));
    fireEvent.keyDown(field(), { key: 'x' });
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledWith('x', true);
  });

  it('Ctrl+C always cancels; Escape only when cancelOnEscape', () => {
    const onCancel = vi.fn();
    const { unmount } = render(<PasswordField onSubmit={() => {}} onCancel={onCancel} />);
    fireEvent.keyDown(field(), { key: 'Escape' });
    expect(onCancel).not.toHaveBeenCalled();
    fireEvent.keyDown(field(), { key: 'c', ctrlKey: true });
    expect(onCancel).toHaveBeenCalledTimes(1);
    unmount();
    render(<PasswordField cancelOnEscape onSubmit={() => {}} onCancel={onCancel} />);
    fireEvent.keyDown(field(), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it('never renders the secret', () => {
    render(<PasswordField onSubmit={() => {}} onCancel={() => {}} />);
    for (const k of 'hunter2') fireEvent.keyDown(field(), { key: k });
    expect(document.body.textContent).not.toContain('hunter2');
  });
});
```

```tsx
// tests/unit/SudoPrompt.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { SudoPrompt } from '../../src/components/SudoPrompt';

const sudoAnswer = vi.fn();
const sudoCancel = vi.fn();

beforeEach(() => {
  sudoAnswer.mockReset();
  sudoCancel.mockReset();
  (window as any).tai = { ai: { sudoAnswer, sudoCancel } };
});
afterEach(() => cleanup());

describe('SudoPrompt', () => {
  it('shows the sudo prompt text', () => {
    render(<SudoPrompt requestId="req-1" prompt="[sudo] password for me:" />);
    expect(screen.getByText('[sudo] password for me:')).toBeInTheDocument();
  });

  it('sends the answer on Enter and nothing per keystroke', () => {
    render(<SudoPrompt requestId="req-1" prompt="p" />);
    const f = screen.getByTestId('password-field');
    fireEvent.keyDown(f, { key: 's' });
    fireEvent.keyDown(f, { key: 'k' });
    expect(sudoAnswer).not.toHaveBeenCalled();
    fireEvent.keyDown(f, { key: 'Enter' });
    expect(sudoAnswer).toHaveBeenCalledWith('req-1', 'sk', false);
  });

  it('Escape cancels', () => {
    render(<SudoPrompt requestId="req-1" prompt="p" />);
    fireEvent.keyDown(screen.getByTestId('password-field'), { key: 'Escape' });
    expect(sudoCancel).toHaveBeenCalledWith('req-1');
  });
});
```

```ts
// tests/unit/sudoDisplay.test.ts
import { describe, it, expect } from 'vitest';
import { hasPendingSudo, applySudoResolved, cancelPendingSudo } from '../../src/utils/sudoDisplay';
import type { DisplayItem } from '../../src/components/BlockList';

type SudoStatus = 'pending' | 'answered' | 'cancelled' | 'auto' | 'refused';
const sudo = (status: SudoStatus, requestId = 'r'): DisplayItem =>
  ({ type: 'sudo', id: `s-${status}-${requestId}`, requestId, prompt: '', status });
const newId = () => 'new-1';

describe('hasPendingSudo', () => {
  it('is true only while a sudo item is pending', () => {
    expect(hasPendingSudo([])).toBe(false);
    expect(hasPendingSudo([sudo('answered'), sudo('cancelled'), sudo('auto'), sudo('refused')])).toBe(false);
    expect(hasPendingSudo([sudo('answered'), sudo('pending')])).toBe(true);
  });
});

describe('applySudoResolved', () => {
  it('marks the pending item answered or cancelled', () => {
    expect(applySudoResolved([sudo('pending', 'req-1')], 'req-1', 'answered', newId))
      .toEqual([{ ...sudo('pending', 'req-1'), status: 'answered' }]);
    expect(applySudoResolved([sudo('pending', 'req-1')], 'req-1', 'cancelled', newId))
      .toEqual([{ ...sudo('pending', 'req-1'), status: 'cancelled' }]);
  });

  it('turns a pending field into a refused warning on a duplicate claim', () => {
    expect(applySudoResolved([sudo('pending', 'req-1')], 'req-1', 'refused-duplicate', newId))
      .toEqual([{ ...sudo('pending', 'req-1'), status: 'refused' }]);
  });

  it('appends a refused warning when no field was showing', () => {
    const items = [sudo('auto', '')];
    expect(applySudoResolved(items, 'req-1', 'refused-duplicate', newId)).toEqual([
      ...items,
      { type: 'sudo', id: 'new-1', requestId: 'req-1', prompt: '', status: 'refused' },
    ]);
  });

  it('ignores an answer or cancel for an unknown request', () => {
    const items = [sudo('answered', 'req-1')];
    expect(applySudoResolved(items, 'req-9', 'answered', newId)).toBe(items);
    expect(applySudoResolved(items, 'req-1', 'cancelled', newId)).toBe(items);
  });
});

describe('cancelPendingSudo', () => {
  it('marks every pending sudo item cancelled and leaves the rest alone', () => {
    const items = [sudo('pending', 'req-1'), sudo('answered', 'req-2'), sudo('pending', 'req-3')];
    expect(cancelPendingSudo(items)).toEqual([
      { ...sudo('pending', 'req-1'), status: 'cancelled' },
      sudo('answered', 'req-2'),
      { ...sudo('pending', 'req-3'), status: 'cancelled' },
    ]);
  });

  it('returns the same array when nothing is pending', () => {
    const items = [sudo('answered', 'req-1'), sudo('refused', 'req-2')];
    expect(cancelPendingSudo(items)).toBe(items);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run --config tests/vitest.config.ts tests/unit/PasswordField.test.tsx tests/unit/SudoPrompt.test.tsx tests/unit/sudoDisplay.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Create `PasswordField`**

```tsx
// src/components/PasswordField.tsx
import { useState, useRef, useEffect } from 'react';
import { Toggle } from './Toggle';

interface PasswordFieldProps {
  /** Called per typed character (the terminal forwards keystrokes live). */
  onChar?: (c: string) => void;
  /** Called per deleted character, only when there was one to delete. */
  onBackspace?: () => void;
  onSubmit: (secret: string, remember: boolean) => void;
  onCancel: () => void;
  cancelOnEscape?: boolean;
}

/** The shared password input: masked dots, Remember toggle, keyboard handling. */
export function PasswordField({ onChar, onBackspace, onSubmit, onCancel, cancelOnEscape }: PasswordFieldProps) {
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
      const secret = secretRef.current;
      secretRef.current = '';
      setDots(0);
      onSubmit(secret, rememberRef.current);
    } else if (e.key === 'Backspace') {
      if (secretRef.current.length > 0) {
        secretRef.current = secretRef.current.slice(0, -1);
        setDots(d => d - 1);
        onBackspace?.();
      }
    } else if ((e.key === 'c' && e.ctrlKey) || (cancelOnEscape && e.key === 'Escape')) {
      secretRef.current = '';
      setDots(0);
      onCancel();
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      secretRef.current += e.key;
      setDots(d => d + 1);
      onChar?.(e.key);
    }
  };

  return (
    <div
      ref={containerRef}
      data-testid="password-field"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      style={{
        margin: '0 14px 4px',
        padding: '10px 16px',
        background: 'var(--bg-card)',
        border: '1px solid rgba(234, 179, 8, 0.2)',
        borderRadius: 'var(--r-lg)',
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
      <span
        onKeyDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.preventDefault()} // keep keyboard focus on the password field
        style={{ display: 'flex', alignItems: 'center', gap: '7px', flexShrink: 0 }}
      >
        <span
          onClick={() => { setRemember(v => !v); containerRef.current?.focus(); }}
          style={{ color: 'var(--text-muted)', fontSize: '11px', cursor: 'pointer', userSelect: 'none' }}
        >
          Remember for this session
        </span>
        <Toggle
          checked={remember}
          onChange={(v) => { setRemember(v); containerRef.current?.focus(); }}
          ariaLabel="Remember sudo password for this session"
        />
      </span>
      <span style={{ color: 'var(--text-muted)', fontSize: '10px', flexShrink: 0 }}>Enter to submit</span>
    </div>
  );
}
```

- [ ] **Step 4: Replace `PasswordPrompt` with a thin wrapper (terminal behaviour unchanged)**

```tsx
// src/components/PasswordPrompt.tsx
import { PasswordField } from './PasswordField';

interface PasswordPromptProps {
  ptyId: number;
  onDone: () => void;
}

/** Terminal sudo: keystrokes go to the PTY as they are typed. */
export function PasswordPrompt({ ptyId, onDone }: PasswordPromptProps) {
  return (
    <PasswordField
      onChar={(c) => window.tai?.pty?.write(ptyId, c)}
      onBackspace={() => window.tai?.pty?.write(ptyId, '\x7f')}
      onSubmit={(secret, remember) => {
        if (remember && secret.length > 0) window.tai?.pty?.rememberSecret?.(secret);
        window.tai?.pty?.write(ptyId, '\n');
        onDone();
      }}
      onCancel={() => {
        window.tai?.pty?.write(ptyId, '\x03');
        onDone();
      }}
    />
  );
}
```

- [ ] **Step 5: Create `SudoPrompt` and `sudoDisplay`**

```tsx
// src/components/SudoPrompt.tsx
import { PasswordField } from './PasswordField';

interface SudoPromptProps {
  requestId: string;
  prompt: string;
}

/**
 * AI sudo: nothing reaches a terminal. The whole secret goes to the main
 * process on Enter, which hands it to sudo through the askpass broker.
 */
export function SudoPrompt({ requestId, prompt }: SudoPromptProps) {
  return (
    <div>
      {prompt && (
        <div style={{ margin: '0 14px 4px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: '11px' }}>
          {prompt}
        </div>
      )}
      <PasswordField
        cancelOnEscape
        onSubmit={(secret, remember) => window.tai?.ai?.sudoAnswer?.(requestId, secret, remember)}
        onCancel={() => window.tai?.ai?.sudoCancel?.(requestId)}
      />
    </div>
  );
}
```

```ts
// src/utils/sudoDisplay.ts
import type { DisplayItem } from '@/components/BlockList';

export function hasPendingSudo(items: DisplayItem[]): boolean {
  return items.some(item => item.type === 'sudo' && item.status === 'pending');
}

/**
 * Apply a `sudo_resolved` message. A duplicate-claim refusal must always be
 * visible, so when there is no pending field to replace (the request was still
 * queued, holding for auto-fill, or already answered) a warning is appended.
 */
export function applySudoResolved(
  items: DisplayItem[],
  requestId: string,
  outcome: unknown,
  newId: () => string,
): DisplayItem[] {
  const status = outcome === 'cancelled' ? 'cancelled' as const
    : outcome === 'refused-duplicate' ? 'refused' as const
    : 'answered' as const;
  const hasPending = items.some(di => di.type === 'sudo' && di.requestId === requestId && di.status === 'pending');
  if (hasPending) {
    return items.map(di =>
      di.type === 'sudo' && di.requestId === requestId && di.status === 'pending' ? { ...di, status } : di
    );
  }
  if (status !== 'refused') return items;
  return [...items, { type: 'sudo' as const, id: newId(), requestId, prompt: '', status }];
}

/**
 * Local cancel for when the renderer stops the AI turn itself. The broker's
 * own `sudo_resolved cancelled` follows and is then a no-op; this makes sure a
 * dead field never lingers if that message is late or lost.
 */
export function cancelPendingSudo(items: DisplayItem[]): DisplayItem[] {
  if (!hasPendingSudo(items)) return items;
  return items.map(di =>
    di.type === 'sudo' && di.status === 'pending' ? { ...di, status: 'cancelled' as const } : di
  );
}
```

- [ ] **Step 6: Run the new tests**

Run: `npx vitest run --config tests/vitest.config.ts tests/unit/PasswordField.test.tsx tests/unit/SudoPrompt.test.tsx tests/unit/sudoDisplay.test.ts`
Expected: all three PASS. (vitest does not typecheck; the `'sudo'` `DisplayItem` member is added in Step 7 and checked by `tsc` in Step 10.)

- [ ] **Step 7: Add the `sudo` display item and its render in `BlockList.tsx`**

Extend the union (the last member currently ends with `answers?: Record<string, string> };`). Change that `;` to a new line and add:
```ts
  | { type: 'sudo'; id: string; requestId: string; prompt: string; status: 'pending' | 'answered' | 'cancelled' | 'auto' | 'refused' };
```
Add import beside `import { ApprovalPrompt } from './ApprovalPrompt';`:
```ts
import { SudoPrompt } from './SudoPrompt';
```
Directly before `if (item.type === 'approval') {` add:
```tsx
    if (item.type === 'sudo') {
      if (item.status === 'pending') {
        return (
          <div key={item.id}>
            <SudoPrompt requestId={item.requestId} prompt={item.prompt} />
          </div>
        );
      }
      if (item.status === 'refused') {
        return (
          <div key={item.id} role="alert" className={styles.sudoWarning}>
            sudo refused: another process claimed this password prompt. Nothing was sent and the cached password was cleared.
          </div>
        );
      }
      const label = item.status === 'auto'
        ? '\u{1F513} sudo authenticated'
        : item.status === 'answered' ? '\u{1F513} sudo password sent' : 'sudo prompt cancelled';
      return <div key={item.id} className={styles.sudoResolved}>{label}</div>;
    }
```
Append to `src/components/BlockList.module.css`:
```css
.sudoResolved {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-muted);
  border-left: 2px solid rgba(234, 179, 8, 0.3);
  padding: 2px 0 2px 8px;
  margin-bottom: 4px;
}

.sudoWarning {
  font-family: var(--font-mono);
  font-size: 11px;
  color: #eab308;
  border-left: 2px solid #eab308;
  padding: 2px 0 2px 8px;
  margin-bottom: 4px;
}
```

- [ ] **Step 8: Handle the messages in `TerminalSession.tsx`**

The `sudo_*` messages are handled in the tab's **always-on** listener, not the per-turn one: `handleStopAI` and `done` tear the per-turn listener down, and the broker's `sudo_resolved cancelled` (sent from `ai:stop`), a cross-tab `refused-duplicate` notice, or a prompt raised outside a live turn must still land.

Add `onAiNeedsInputChange?: (needsInput: boolean) => void;` to `TerminalSessionProps` after `onAiWorkingChange`, and add `onAiNeedsInputChange` to the destructured parameters after `onAiWorkingChange`.

Add import beside `hasActiveAi`'s import:
```ts
import { hasPendingSudo, applySudoResolved, cancelPendingSudo } from '@/utils/sudoDisplay';
```

(a) In the always-on effect that begins `// Persistent listener for daemon lifecycle messages that arrive outside of a conversation`, directly after its `remote:daemon_disconnected` `if` block (the line `        showDaemonToast('Daemon disconnected', false);` and its closing `      }`), add:
```ts
      // AI sudo (askpass broker). Handled here, not in the per-turn listener,
      // so a resolution that arrives after Stop or outside a turn still lands.
      if (msg.type === 'sudo_prompt') {
        setDisplayItems(prev => [...prev, {
          type: 'sudo' as const,
          id: nextBlockId(),
          requestId: String(msg.requestId),
          prompt: typeof msg.prompt === 'string' ? msg.prompt : '',
          status: 'pending' as const,
        }]);
      }
      if (msg.type === 'sudo_resolved') {
        const requestId = String(msg.requestId);
        setDisplayItems(prev => applySudoResolved(prev, requestId, msg.outcome, nextBlockId));
      }
      if (msg.type === 'sudo_auth') {
        setDisplayItems(prev => [...prev, {
          type: 'sudo' as const, id: nextBlockId(), requestId: '', prompt: '', status: 'auto' as const,
        }]);
      }
```
(The effect's deps stay `[tabId]`: `setDisplayItems` is stable and `nextBlockId`/`applySudoResolved` are module functions.)

(b) In the per-turn handler, directly before `if (msg.type === 'approval_needed') {`, add only the block-ordering flag (no item changes — those happen in (a)):
```ts
      if (msg.type === 'sudo_prompt' || msg.type === 'sudo_auth') {
        // The sudo item was appended by the always-on listener; later AI text
        // starts a new block below it instead of growing the one above.
        needsNewBlock = true;
        return;
      }
      if (msg.type === 'sudo_resolved') return;
```

(c) Directly before the existing effect
```ts
  useEffect(() => {
    if (visible) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [visible]);
```
add
```ts
  const aiNeedsInput = hasPendingSudo(displayItems);
  useEffect(() => {
    onAiNeedsInputChange?.(aiNeedsInput);
  }, [aiNeedsInput, onAiNeedsInputChange]);
```
and replace that effect with (never pull focus to the composer while an AI sudo field is pending — a password typed there would be sent to the AI):
```ts
  useEffect(() => {
    if (visible && !aiNeedsInput) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [visible, aiNeedsInput]);
```

(d) In the window-focus effect, replace
```ts
      if (!modeSignals.altScreenVisible && !awaitingInput && !passwordPrompt) inputRef.current?.focus();
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [visible, modeSignals.altScreenVisible, awaitingInput, passwordPrompt]);
```
with
```ts
      if (!modeSignals.altScreenVisible && !awaitingInput && !passwordPrompt && !aiNeedsInput) inputRef.current?.focus();
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [visible, modeSignals.altScreenVisible, awaitingInput, passwordPrompt, aiNeedsInput]);
```

(e) In the `surface` focus effect, replace
```ts
    if (target === 'composer') {
      requestAnimationFrame(() => inputRef.current?.focus());
```
with
```ts
    if (target === 'composer') {
      if (!aiNeedsInput) requestAnimationFrame(() => inputRef.current?.focus());
```
and its deps `}, [surface]);` with `}, [surface, aiNeedsInput]);`.

(f) In `handleStopAI`, directly after `providerRef.current.stop();`, add:
```ts
      // Belt and braces: the broker's cancel notice follows, but a dead field
      // must not linger even if it is late.
      setDisplayItems(prev => cancelPendingSudo(prev));
```

- [ ] **Step 9: Tab attention marker**

`src/types.ts` — in `TabState`, after `aiWorking?: boolean;`:
```ts
  aiNeedsInput?: boolean;
```
`src/App.tsx` — directly after `handleAiWorkingChange`:
```ts
  const handleAiNeedsInputChange = useCallback((tabId: string, needsInput: boolean) => {
    setTabs(prev => {
      const tab = prev.find(t => t.id === tabId);
      if (!tab || !!tab.aiNeedsInput === needsInput) return prev;
      return prev.map(t => t.id === tabId ? { ...t, aiNeedsInput: needsInput } : t);
    });
  }, []);
```
and directly after `onAiWorkingChange={(working) => handleAiWorkingChange(tab.id, working)}`:
```tsx
            onAiNeedsInputChange={(needsInput) => handleAiNeedsInputChange(tab.id, needsInput)}
```
`src/components/TabSidebar.tsx` — directly after the `workingDot` span line:
```tsx
              {tab.aiNeedsInput && !isActive && <span className={styles.attentionDot} aria-label="Needs your input" />}
```
Append to `src/components/TabSidebar.module.css`:
```css
.attentionDot {
  flex-shrink: 0;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #eab308;
}
```

- [ ] **Step 10: Typecheck and run the full suite**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit 0. (If a `switch`/exhaustive check over `DisplayItem` elsewhere now errors on `'sudo'`, add a `'sudo'` branch there that mirrors how that code treats `'approval'`.)

Run: `npx tsc --noEmit -p tsconfig.node.json 2>&1 | grep 'error TS' | grep -v TS6307`
Expected: only the two pre-existing lines.

Run: `npm test`
Expected: all pass, including existing `inputSurface.test.ts` (which references `PasswordPrompt`).

- [ ] **Step 11: Commit**

```bash
git add src/components/PasswordField.tsx src/components/PasswordPrompt.tsx src/components/SudoPrompt.tsx \
  src/utils/sudoDisplay.ts src/components/BlockList.tsx src/components/BlockList.module.css \
  src/components/TerminalSession.tsx src/types.ts src/App.tsx src/components/TabSidebar.tsx \
  src/components/TabSidebar.module.css \
  tests/unit/PasswordField.test.tsx tests/unit/SudoPrompt.test.tsx tests/unit/sudoDisplay.test.ts
git commit -m "feat(askpass): answer AI sudo from a password field in the AI block

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: macOS CI coverage and in-app verification

**Files:**
- Modify: `.github/workflows/test.yml` (append a job)

- [ ] **Step 1: Add the macOS job**

Append under `jobs:` (same indentation as `test:`):
```yaml
  # The askpass parent check and socket refusal run against real processes;
  # macOS takes the ps path instead of /proc, so exercise it on a mac runner.
  askpass-macos:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      # Skip postinstall: it rebuilds node-pty for Electron, which these tests never load.
      - run: npm ci --ignore-scripts
      - run: >-
          npx vitest run --config tests/vitest.config.ts
          tests/unit/sudoParent.test.ts
          tests/unit/askpassDecision.test.ts
          tests/unit/askpassHelper.test.ts
          tests/unit/askpassBroker.test.ts
          tests/unit/askpassServer.test.ts
```

- [ ] **Step 2: Validate the YAML**

Run: `python3 -c "import yaml;d=yaml.safe_load(open('.github/workflows/test.yml'));print(sorted(d['jobs']))"`
Expected: `['askpass-macos', 'test']`

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/test.yml
git commit -m "ci: run askpass tests on macOS

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 4: In-app verification (dev build, user present)**

Start `npm run dev`. Use CDP on `127.0.0.1:9222` (see memory `reference_cdp_in_app_verification`) to observe the DOM; the user types passwords. In a TAI tab with the Claude provider, trust level **Ask**:

1. Ensure nothing cached (no "sudo cached" badge). Ask the AI: "run `sudo -k; sudo true` and tell me the exit code". Approve the Bash call.
   Expected: a password field appears inside the AI block (`[data-testid="password-field"]` present); **no** `ksshaskpass` window. User types password with Remember **off** → exit code 0; block shows "sudo password sent".
2. Ask again with Remember **on** → exit 0; terminal badge shows "sudo cached".
3. Ask: "run `sudo -k; sudo true`" again → no field; block shows "sudo authenticated" (after the 150 ms hold, not perceptible); exit 0.
4. **Security check:** Ask: "run `\"$SUDO_ASKPASS\"; echo EXIT=$?` and show me the raw output". Expected output: empty line(s) and `EXIT=1`. The cached password must not appear. The badge still shows "sudo cached" and no "sudo refused" warning appears (a non-sudo parent is refused before any claim, so it must not trip the duplicate wire).
5. Click the badge to forget → ask for `sudo -k; sudo true` → field appears again. Press Escape → block shows "sudo prompt cancelled"; AI reports a non-zero exit.
6. Switch to another tab before approving a sudo command in step 1's flow; confirm the original tab shows the amber attention dot while the field is pending, and it clears after answering. When switching back to that tab (and after alt-tabbing away from and back to the TAI window) with the field still pending, confirm focus is **not** in the composer (`document.activeElement` is not the composer input); click the field, then answer.
6b. With a field pending, press the AI Stop control. Expected: the block shows "sudo prompt cancelled" (no live field left behind) and the attention dot clears.
7. **Probe check C:** right after step 5's cancel, the user runs `faillock --user "$USER"` in a terminal. Record whether the cancel appears as a failure record (the probe did not reach this).

The duplicate-claim tripwire (`sudo refused: another process claimed this password prompt…`) cannot be triggered in-app without deliberately spoofing a live sudo helper's pid; it is covered by the Task 5 broker tests and the Task 8 `applySudoResolved` tests. Do not attempt it against the real account.

Record results for the final report. Also note: Codex in its default `--full-auto` sandbox sets no-new-privileges, so `sudo` cannot elevate there regardless of askpass — do not treat a Codex sandbox failure as a bug in this feature.

- [ ] **Step 5: Final full suite**

Run: `npm test`
Expected: all pass. Report the file/test counts.
