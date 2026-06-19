# zsh ZDOTDIR + bash echo suppression — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Load the zsh integration via a `ZDOTDIR` shim (no typed `source`, no echo, no history, no idle wait), and suppress bash's residual on-screen echo of its typed bootstrap.

**Architecture:** A static `zsh-shim/` dir of four startup files redirects zsh's startup through us; `pty.ts` points `ZDOTDIR` at it for zsh and skips the typed injection. bash/fish keep the typed injection; the renderer's `BlockSegmenter` drops the bash bootstrap-echo line.

**Tech Stack:** TypeScript, Electron (main), zsh/bash startup files, Vitest. **zsh is NOT installed on the dev machine** — TS logic is unit-tested, shim files are static-reviewed, real-zsh is an in-app release gate.

## Global Constraints

- Run tests with `npm test`. NEVER bare `npx vitest run`. Baseline: 673 test files green; keep green + `npx tsc --noEmit` clean + `npm run build` clean.
- `@/` = `src/`.
- **Must not break a user's zsh env:** all of `.zshenv/.zprofile/.zshrc/.zlogin` run once, in order, for a login interactive shell; the integration loads AFTER the user's `.zshrc`; `ZDOTDIR` is restored (to the user's original value, or unset if it was unset) before children/`.zlogin`.
- bash/fish launch + injection are UNCHANGED. Only zsh stops being typed-injected.
- Pure helpers for env-building and echo-matching so they unit-test without a shell.
- Commit after every task.

## File Structure

- `electron/shell-integration/zsh-shim/{.zshenv,.zprofile,.zshrc,.zlogin}` — new static shim files.
- `electron/services/pty.ts` — new pure `buildZshShimEnv(...)`; zsh branch sets the shim env + skips typed injection.
- `src/utils/bootstrapEcho.ts` — new pure `isBootstrapEchoLine(command)`.
- `src/components/BlockSegmenter.ts` — drop a block/line whose command is a bootstrap echo.

---

### Task 1: `buildZshShimEnv` pure helper

**Files:**
- Modify: `electron/services/pty.ts` (add + export the helper)
- Test: `tests/unit/zshShimEnv.test.ts`

**Interfaces:**
- Produces: `buildZshShimEnv(baseEnv: Record<string,string>, opts: { shimDir: string; integrationPath: string; home: string }): Record<string,string>` — returns a NEW env object (does not mutate `baseEnv`) with `ZDOTDIR=shimDir`, `TAI_ZSH_SHIM=shimDir`, `TAI_ZSH_INTEGRATION=integrationPath`, `TAI_ZDOTDIR_USER=(baseEnv.ZDOTDIR || home)`, and `TAI_ZDOTDIR_WAS_SET=(baseEnv.ZDOTDIR ? '1' : '')`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/zshShimEnv.test.ts
import { describe, it, expect } from 'vitest';
import { buildZshShimEnv } from '../../electron/services/pty';

const opts = { shimDir: '/app/zsh-shim', integrationPath: '/app/tai-zsh.zsh', home: '/home/u' };

describe('buildZshShimEnv', () => {
  it('points ZDOTDIR at the shim and records the integration path', () => {
    const e = buildZshShimEnv({}, opts);
    expect(e.ZDOTDIR).toBe('/app/zsh-shim');
    expect(e.TAI_ZSH_SHIM).toBe('/app/zsh-shim');
    expect(e.TAI_ZSH_INTEGRATION).toBe('/app/tai-zsh.zsh');
  });
  it('defaults TAI_ZDOTDIR_USER to HOME and marks not-set when ZDOTDIR is absent', () => {
    const e = buildZshShimEnv({}, opts);
    expect(e.TAI_ZDOTDIR_USER).toBe('/home/u');
    expect(e.TAI_ZDOTDIR_WAS_SET).toBe('');
  });
  it('preserves a user-set ZDOTDIR and marks it set', () => {
    const e = buildZshShimEnv({ ZDOTDIR: '/home/u/.zsh' }, opts);
    expect(e.TAI_ZDOTDIR_USER).toBe('/home/u/.zsh');
    expect(e.TAI_ZDOTDIR_WAS_SET).toBe('1');
  });
  it('does not mutate the input env', () => {
    const base: Record<string,string> = {};
    buildZshShimEnv(base, opts);
    expect(base.ZDOTDIR).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- zshShimEnv`
Expected: FAIL — `buildZshShimEnv` not exported.

- [ ] **Step 3: Write minimal implementation**

In `electron/services/pty.ts` (near `buildIntegrationSourceCommand`):

```ts
export function buildZshShimEnv(
  baseEnv: Record<string, string>,
  opts: { shimDir: string; integrationPath: string; home: string },
): Record<string, string> {
  const userZdotdir = baseEnv.ZDOTDIR || opts.home;
  return {
    ...baseEnv,
    ZDOTDIR: opts.shimDir,
    TAI_ZSH_SHIM: opts.shimDir,
    TAI_ZSH_INTEGRATION: opts.integrationPath,
    TAI_ZDOTDIR_USER: userZdotdir,
    TAI_ZDOTDIR_WAS_SET: baseEnv.ZDOTDIR ? '1' : '',
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- zshShimEnv`
Expected: PASS (4 tests).

- [ ] **Step 5: Verify suite + types**

Run: `npm test && npx tsc --noEmit`
Expected: PASS, clean.

- [ ] **Step 6: Commit**

```bash
git add electron/services/pty.ts tests/unit/zshShimEnv.test.ts
git commit -m "feat(shell): buildZshShimEnv helper for ZDOTDIR integration loading"
```

---

### Task 2: The four zsh shim files

**Files:**
- Create: `electron/shell-integration/zsh-shim/.zshenv`, `.zprofile`, `.zshrc`, `.zlogin`
- Test: `tests/unit/zshShimFiles.test.ts` (structural assertions — zsh can't run here)

**Interfaces:** consumed at runtime via the env vars from Task 1 (`TAI_ZDOTDIR_USER`, `TAI_ZSH_SHIM`, `TAI_ZSH_INTEGRATION`, `TAI_ZDOTDIR_WAS_SET`).

- [ ] **Step 1: Write the failing test (structural)**

```ts
// tests/unit/zshShimFiles.test.ts
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const dir = path.resolve(__dirname, '../../electron/shell-integration/zsh-shim');
const read = (f: string) => fs.readFileSync(path.join(dir, f), 'utf8');

describe('zsh shim files', () => {
  it('ships all four startup files', () => {
    for (const f of ['.zshenv', '.zprofile', '.zshrc', '.zlogin']) {
      expect(fs.existsSync(path.join(dir, f)), f).toBe(true);
    }
  });
  it('.zshrc sources the user .zshrc, then the integration, then restores ZDOTDIR', () => {
    const z = read('.zshrc');
    expect(z).toMatch(/TAI_ZDOTDIR_USER.*\.zshrc/s);            // sources user's
    expect(z).toContain('$TAI_ZSH_INTEGRATION');                // loads integration
    expect(z).toMatch(/unset ZDOTDIR|ZDOTDIR=.*TAI_ZDOTDIR_USER/); // restores
  });
  it('.zshenv and .zprofile source the user file and re-assert the shim dir', () => {
    for (const f of ['.zshenv', '.zprofile']) {
      const z = read(f);
      expect(z, f).toMatch(/TAI_ZDOTDIR_USER/);
      expect(z, f).toMatch(/ZDOTDIR="?\$\{?TAI_ZSH_SHIM/);  // re-assert shim
    }
  });
  it('every shim file guards user-file existence with [ -f ]', () => {
    for (const f of ['.zshenv', '.zprofile', '.zshrc', '.zlogin']) {
      expect(read(f), f).toMatch(/\[ -f /);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- zshShimFiles`
Expected: FAIL — files don't exist.

- [ ] **Step 3: Create the shim files**

`electron/shell-integration/zsh-shim/.zshenv`:
```zsh
# TAI zsh shim — loaded because TAI set ZDOTDIR to this dir. Source the user's
# real .zshenv, then re-assert the shim dir so the remaining startup files
# (.zprofile/.zshrc) are still read from here.
[ -f "$TAI_ZDOTDIR_USER/.zshenv" ] && source "$TAI_ZDOTDIR_USER/.zshenv"
[ -n "$TAI_ZSH_SHIM" ] && ZDOTDIR="$TAI_ZSH_SHIM"
```

`electron/shell-integration/zsh-shim/.zprofile`:
```zsh
# TAI zsh shim — login shells. Source the user's real .zprofile, then re-assert
# the shim dir for .zshrc.
[ -f "$TAI_ZDOTDIR_USER/.zprofile" ] && source "$TAI_ZDOTDIR_USER/.zprofile"
[ -n "$TAI_ZSH_SHIM" ] && ZDOTDIR="$TAI_ZSH_SHIM"
```

`electron/shell-integration/zsh-shim/.zshrc`:
```zsh
# TAI zsh shim — source the user's real .zshrc, then load the TAI integration
# (after the user's prompt/hooks are in place), then restore ZDOTDIR so child
# shells and the user's .zlogin use normal config.
[ -f "$TAI_ZDOTDIR_USER/.zshrc" ] && source "$TAI_ZDOTDIR_USER/.zshrc"
[ -f "$TAI_ZSH_INTEGRATION" ] && source "$TAI_ZSH_INTEGRATION"
if [ -n "$TAI_ZDOTDIR_WAS_SET" ]; then
  export ZDOTDIR="$TAI_ZDOTDIR_USER"
else
  unset ZDOTDIR
fi
```

`electron/shell-integration/zsh-shim/.zlogin`:
```zsh
# TAI zsh shim — safety net. In the normal login flow .zshrc already restored
# ZDOTDIR, so zsh reads the user's real .zlogin from their dir and this file is
# not read. It only runs if .zshrc was somehow skipped; keep behavior correct.
[ -f "$TAI_ZDOTDIR_USER/.zlogin" ] && source "$TAI_ZDOTDIR_USER/.zlogin"
if [ -n "$TAI_ZDOTDIR_WAS_SET" ]; then
  export ZDOTDIR="$TAI_ZDOTDIR_USER"
else
  unset ZDOTDIR
fi
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- zshShimFiles`
Expected: PASS (4 tests).

- [ ] **Step 5: Verify packaging includes the dotfiles**

Run: `npm run build` then confirm the shim ships:
```bash
ls -a dist-electron 2>/dev/null >/dev/null; npm run build >/dev/null 2>&1
node -e "const fs=require('fs');const p='electron/shell-integration/zsh-shim';console.log(fs.readdirSync(p))"
```
The `extraResources` entry copies `electron/shell-integration` → `shell-integration` as a directory (dotfiles included in a dir copy). If a later `electron-builder` packaging step is available, confirm `.zshrc` etc. appear under `resources/shell-integration/zsh-shim/`. If the build globs exclude dotfiles, add an explicit `extraResources` filter `"**/.*"` — document what you did. (The `npm run build` here only runs vite; full electron-builder packaging may not run in this env — at minimum assert the source dir has the dotfiles and note the packaging check for the release box.)

- [ ] **Step 6: Commit**

```bash
git add electron/shell-integration/zsh-shim tests/unit/zshShimFiles.test.ts
git commit -m "feat(shell): zsh ZDOTDIR shim startup files"
```

---

### Task 3: Wire pty.ts — zsh uses the shim, skips typed injection

**Files:**
- Modify: `electron/services/pty.ts`
- Test: covered by Task 1's helper test + manual/static; add a focused assertion only if a clean seam exists.

**Interfaces:**
- Consumes: `buildZshShimEnv` (Task 1), `shellIntegrationDir()`, `integrationScriptFor('zsh')`.

- [ ] **Step 1: Apply the wiring**

In `pty:create` (`pty.ts` ~109-142), after `env` is built and `shell`/`shellName` are known (note: `shellName` is currently computed later at ~181 — compute it earlier, near the `env` construction, or read `detectShellName(shell)` here):

```ts
const shellName = isWindows ? null : detectShellName(shell);
// zsh: load integration via a ZDOTDIR shim at startup (no typed source, no echo,
// no history). Other shells keep the typed-injection path below.
let zshShimActive = false;
if (!isWindows && shellName === 'zsh') {
  const dir = shellIntegrationDir();
  const integ = integrationScriptFor('zsh');
  const shim = dir ? path.join(dir, 'zsh-shim') : null;
  if (shim && integ && fs.existsSync(shim)) {
    Object.assign(env, buildZshShimEnv(env, { shimDir: shim, integrationPath: integ, home: os.homedir() }));
    zshShimActive = true;
  }
}
```

Then, in the typed-injection block (`pty.ts` ~189: `if (!isWindows && script) {`), skip it for zsh when the shim is active:

```ts
if (!isWindows && script && !(shellName === 'zsh' && zshShimActive)) {
  // ...existing typed-injection (bash/fish, and zsh fallback if shim missing)
}
```

Keep the zsh fallback: if the shim dir is missing (`zshShimActive` false), the existing typed injection still runs for zsh — no regression.

- [ ] **Step 2: Verify suite + types + build**

Run: `npm test && npx tsc --noEmit && npm run build`
Expected: PASS, clean, build OK. (`buildZshShimEnv` is already exercised by Task 1's tests; the wiring is verified by tsc + the no-regression that bash/fish still build their source command.)

- [ ] **Step 3: Commit**

```bash
git add electron/services/pty.ts
git commit -m "feat(shell): load zsh integration via ZDOTDIR shim, skip typed source"
```

---

### Task 4: Suppress the bash bootstrap echo line

**Files:**
- Create: `src/utils/bootstrapEcho.ts`
- Test: `tests/unit/bootstrapEcho.test.ts`
- Modify: `src/components/BlockSegmenter.ts`

**Interfaces:**
- Produces: `isBootstrapEchoLine(line: string): boolean` — true for a `.`/`source` of our integration script (`tai-bash.sh`, `tai-zsh.zsh`, or `shell-integration.sh`/`.zsh`), false for a real command that merely mentions the path.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/bootstrapEcho.test.ts
import { describe, it, expect } from 'vitest';
import { isBootstrapEchoLine } from '@/utils/bootstrapEcho';

describe('isBootstrapEchoLine', () => {
  it('matches the injected bootstrap echo (with leading space + quotes)', () => {
    expect(isBootstrapEchoLine(" . '/tmp/x/tai-bash.sh'")).toBe(true);
    expect(isBootstrapEchoLine(". /home/u/.config/tai/shell-integration.sh")).toBe(true);
    expect(isBootstrapEchoLine(" source '/a/b/tai-zsh.zsh'")).toBe(true);
  });
  it('does NOT match a real command that merely mentions the script', () => {
    expect(isBootstrapEchoLine('cat tai-bash.sh')).toBe(false);
    expect(isBootstrapEchoLine('vim /x/tai-bash.sh')).toBe(false);
    expect(isBootstrapEchoLine('git diff tai-bash.sh')).toBe(false);
    expect(isBootstrapEchoLine('echo source tai-bash.sh')).toBe(false);
  });
  it('does not match empty / unrelated lines', () => {
    expect(isBootstrapEchoLine('')).toBe(false);
    expect(isBootstrapEchoLine('ls -la')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- bootstrapEcho`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/utils/bootstrapEcho.ts
// Matches the line TAI types to load its integration: a `.`/`source` builtin
// applied to our integration script. Anchored to the start so a real command
// that merely mentions the path (cat/vim/git tai-bash.sh) never matches.
const BOOTSTRAP_ECHO_RE =
  /^\s*(?:\.|source)\s+'?\S*(?:tai-bash\.sh|tai-zsh\.zsh|shell-integration\.(?:sh|zsh))'?\s*$/;

export function isBootstrapEchoLine(line: string): boolean {
  return BOOTSTRAP_ECHO_RE.test(line);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- bootstrapEcho`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire into BlockSegmenter**

Read `src/components/BlockSegmenter.ts` around the pre-first-prompt / noise handling (`_finalizeBlock` ~332-369 drops "pure echo noise"; the bootstrap echo arrives in the early output before the first OSC 133 A). Add: when assembling a block's command line or filtering early raw lines, drop a line where `isBootstrapEchoLine(line)` is true (import from `@/utils/bootstrapEcho`). The cleanest insertion is wherever the command-echo line is extracted/emitted — if the extracted command matches, suppress that block (treat like the existing empty/noise drop). Add a focused test in an existing BlockSegmenter test file (or new) feeding a stream containing the bootstrap echo line and asserting no block/command for it, while a normal following command still segments.

- [ ] **Step 6: Verify suite + types**

Run: `npm test && npx tsc --noEmit`
Expected: PASS, clean. (Existing BlockSegmenter tests must stay green.)

- [ ] **Step 7: Commit**

```bash
git add src/utils/bootstrapEcho.ts tests/unit/bootstrapEcho.test.ts src/components/BlockSegmenter.ts
git commit -m "fix(shell): suppress the bash bootstrap-echo line in the block view"
```

---

**▶ Checkpoint — REAL-ZSH IN-APP VERIFICATION (release gate; needs a machine with zsh):**
Open a zsh tab and confirm:
1. No `. '/…'` echo flashes on open; nothing appears in `history` / up-arrow for it.
2. The user's prompt/theme is intact and `echo $ZDOTDIR` shows the user's original value (or is unset).
3. Blocks segment correctly (OSC 133/6973 working — exit codes, cwd, durations).
4. A nested `zsh` subshell starts normally (ZDOTDIR restored — no recursion into the shim).
5. A user with no `.zshrc` and one with a custom `$ZDOTDIR` both work.
Open a bash tab: confirm no bootstrap echo flash, and normal commands/blocks unaffected.

## Self-Review

- **Spec coverage:** ZDOTDIR env → Task 1; the four shim files w/ correct ordering + restore → Task 2; zsh skips typed injection (with fallback) → Task 3; bash echo suppression → Task 4; packaging-dotfiles check → Task 2 Step 5; real-zsh gate → checkpoint.
- **Placeholder scan:** real code for all pure pieces; the two integration sites (pty.ts wiring, BlockSegmenter drop) are described against named functions/line-regions, not TODOs.
- **Type consistency:** `buildZshShimEnv`, `isBootstrapEchoLine`, and the env var names (`TAI_ZSH_SHIM`/`TAI_ZSH_INTEGRATION`/`TAI_ZDOTDIR_USER`/`TAI_ZDOTDIR_WAS_SET`) are defined once and used consistently across the helper, the shim files, and the wiring.
