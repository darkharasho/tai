# Card / Shell-Integration Rearchitecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace TAI's regex-driven block segmentation and password-prompt detection with a deterministic shell-integration channel (OSC 6973 JSON sidechannel), termios-driven echo detection, and a card body that adapts its UI to what the running process actually wants (line output, full TUI, or password input).

**Architecture:** Single PTY, single real shell. Shell rc emits OSC 133 (already in place) plus a new OSC 6973 JSON sidechannel carrying `preexec`/`precmd` metadata. Main process polls `tcgetattr` on the PTY master fd at 1Hz while a block is active and fires `pty:echo-change` IPC events. Renderer's `BlockSegmenter` consumes both channels; `CommandBlock` becomes a small state machine over body modes (`Output | Interactive | PasswordPrompt`). Per-card input writes to PTY stdin while a block owns the foreground; global input queues.

**Tech Stack:** TypeScript, React, Electron, node-pty, xterm.js, vitest. New dependency: `node-termios` (or equivalent — see Task 8). Spec: `docs/superpowers/specs/2026-06-01-card-shell-integration-design.md`.

---

## File Structure

**Created:**
- `electron/services/termiosPoller.ts` — wraps `tcgetattr` on a master fd, exposes start/stop poll loop per pty id.
- `src/types/shellHooks.ts` — shared TypeScript types for the OSC 6973 JSON payload schema (`PreexecHook`, `PrecmdHook`).
- `src/utils/osc6973.ts` — parse/decode helpers (`parseOsc6973(payload: string): ShellHook | null`).
- `tests/unit/osc6973.test.ts` — payload parser unit tests.
- `tests/unit/blockSegmenterHooks.test.ts` — segmenter integration with the hook channel.
- `tests/unit/termiosPoller.test.ts` — poller lifecycle (mocked).

**Modified:**
- `electron/shell-integration/tai-bash.sh` — add OSC 6973 emission from `preexec`/`precmd` hooks.
- `electron/shell-integration/tai-zsh.zsh` — same.
- `electron/shell-integration/tai-fish.fish` — same.
- `electron/services/pty.ts` — start/stop termios poller per pty; relay `pty:echo-change` IPC.
- `electron/preload.ts` — expose `onEchoChange` on `window.tai.pty`.
- `src/types.ts` — extend `SegmentedBlock` with `signal`, `cwd`, `commandFromShell` fields.
- `src/components/BlockSegmenter.ts` — parse OSC 6973; enrich blocks; new `BlockBodyMode` event channel.
- `src/components/TerminalSession.tsx` — subscribe to `pty:echo-change`; route password mode into the active card instead of a session-modal `PasswordPrompt`; grey out global input while a block is active.
- `src/components/CommandBlock.tsx` — body-mode state machine; per-card input; embedded password field.
- `src/components/PasswordPrompt.tsx` — refactor to be card-attached (drop session-modal layout).
- `src/components/TerminalInput.tsx` — `disabled` prop driven by active-block state; queue affordance copy.
- `tests/unit/taiBashIntegration.test.ts` — extend with OSC 6973 assertions.

**Out of scope (deferred):**
- AI integration consumes the new metadata (separate spec).
- Windows / PowerShell shell integration (separate spec).
- Per-card xterm view for arbitrary alt-screen TUIs (Task 11 handles the common case; full fidelity is a follow-up).

---

## Task 1: Define the OSC 6973 wire format (shared types + constant)

**Files:**
- Create: `src/types/shellHooks.ts`
- Create: `src/utils/osc6973.ts`
- Test: `tests/unit/osc6973.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/osc6973.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseOsc6973, encodeOsc6973 } from '@/utils/osc6973';
import type { PreexecHook, PrecmdHook } from '@/types/shellHooks';

describe('parseOsc6973', () => {
  it('decodes a preexec payload', () => {
    const payload: PreexecHook = { hook: 'preexec', command: 'ls -la' };
    const hex = Buffer.from(JSON.stringify(payload)).toString('hex');
    expect(parseOsc6973(hex)).toEqual(payload);
  });

  it('decodes a precmd payload with all fields', () => {
    const payload: PrecmdHook = {
      hook: 'precmd',
      exit: 0,
      signal: null,
      duration_ms: 142,
      command: 'git status',
      cwd: '/home/m/code/tai',
    };
    const hex = Buffer.from(JSON.stringify(payload)).toString('hex');
    expect(parseOsc6973(hex)).toEqual(payload);
  });

  it('returns null for malformed hex', () => {
    expect(parseOsc6973('zzz')).toBeNull();
  });

  it('returns null for non-JSON', () => {
    const hex = Buffer.from('not json').toString('hex');
    expect(parseOsc6973(hex)).toBeNull();
  });

  it('returns null for unknown hook names', () => {
    const hex = Buffer.from(JSON.stringify({ hook: 'wat' })).toString('hex');
    expect(parseOsc6973(hex)).toBeNull();
  });
});

describe('encodeOsc6973', () => {
  it('round-trips through parseOsc6973', () => {
    const payload: PreexecHook = { hook: 'preexec', command: 'echo hi' };
    const encoded = encodeOsc6973(payload);
    expect(encoded).toMatch(/^\x1b\]6973;[0-9a-f]+\x07$/);
    const hex = encoded.slice('\x1b]6973;'.length, -1);
    expect(parseOsc6973(hex)).toEqual(payload);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run tests/unit/osc6973.test.ts
```

Expected: FAIL (modules not found).

- [ ] **Step 3: Write the types**

Create `src/types/shellHooks.ts`:

```typescript
export interface PreexecHook {
  hook: 'preexec';
  command: string;
}

export interface PrecmdHook {
  hook: 'precmd';
  exit: number;
  signal: string | null;
  duration_ms: number;
  command: string;
  cwd: string;
}

export type ShellHook = PreexecHook | PrecmdHook;

export const OSC6973_PREFIX = '\x1b]6973;';
export const OSC6973_TERMINATOR = '\x07';
```

- [ ] **Step 4: Write the parser**

Create `src/utils/osc6973.ts`:

```typescript
import type { ShellHook } from '@/types/shellHooks';
import { OSC6973_PREFIX, OSC6973_TERMINATOR } from '@/types/shellHooks';

export function parseOsc6973(hex: string): ShellHook | null {
  if (!/^[0-9a-fA-F]*$/.test(hex) || hex.length % 2 !== 0) return null;
  let json: string;
  try {
    json = Buffer.from(hex, 'hex').toString('utf8');
  } catch {
    return null;
  }
  let obj: unknown;
  try {
    obj = JSON.parse(json);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object') return null;
  const hook = (obj as { hook?: unknown }).hook;
  if (hook !== 'preexec' && hook !== 'precmd') return null;
  return obj as ShellHook;
}

export function encodeOsc6973(payload: ShellHook): string {
  const hex = Buffer.from(JSON.stringify(payload), 'utf8').toString('hex');
  return `${OSC6973_PREFIX}${hex}${OSC6973_TERMINATOR}`;
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
npx vitest run tests/unit/osc6973.test.ts
```

Expected: PASS, all 6 tests.

- [ ] **Step 6: Commit**

```bash
git add src/types/shellHooks.ts src/utils/osc6973.ts tests/unit/osc6973.test.ts
git commit -m "feat(shell-integration): OSC 6973 JSON sidechannel parser"
```

---

## Task 2: Emit OSC 6973 from tai-bash.sh

**Files:**
- Modify: `electron/shell-integration/tai-bash.sh`
- Test: `tests/unit/taiBashIntegration.test.ts`

- [ ] **Step 1: Read the existing test fixture to understand pattern**

```bash
head -80 tests/unit/taiBashIntegration.test.ts
```

The test spawns a real bash with the integration script and asserts on the bytes it emits. We'll extend it. If the file doesn't exist or uses a different pattern, follow the conventions you observe; do not rewrite it.

- [ ] **Step 2: Write the failing test**

Append to `tests/unit/taiBashIntegration.test.ts`:

```typescript
import { spawnSync } from 'child_process';
import { parseOsc6973 } from '@/utils/osc6973';

describe('tai-bash.sh OSC 6973 emission', () => {
  it('emits a preexec hook before running a command', () => {
    // Spawn bash with our integration sourced, run `echo hi`, capture all
    // bytes written to the tty. Assert we see OSC 6973 with hook=preexec
    // and command="echo hi", followed (later) by OSC 6973 with hook=precmd
    // and exit=0.
    const script = `
      source electron/shell-integration/tai-bash.sh
      echo hi
      exit
    `;
    const result = spawnSync('bash', ['-i', '-c', script], { encoding: 'utf8' });
    const stdout = result.stdout;
    const osc6973Re = /\x1b\]6973;([0-9a-f]+)\x07/g;
    const hooks = [];
    let m;
    while ((m = osc6973Re.exec(stdout)) !== null) {
      const parsed = parseOsc6973(m[1]);
      if (parsed) hooks.push(parsed);
    }
    const preexec = hooks.find(h => h.hook === 'preexec' && h.command.includes('echo hi'));
    const precmd = hooks.find(h => h.hook === 'precmd' && h.exit === 0);
    expect(preexec).toBeDefined();
    expect(precmd).toBeDefined();
    expect(precmd?.duration_ms).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
npx vitest run tests/unit/taiBashIntegration.test.ts
```

Expected: FAIL (no OSC 6973 emitted yet).

- [ ] **Step 4: Modify tai-bash.sh to emit hooks**

Edit `electron/shell-integration/tai-bash.sh`. Replace the entire contents with:

```bash
# tai shell integration for bash — emits OSC 133 semantic prompts plus
# OSC 6973 JSON sidechannel for structured command metadata.

case "$-" in *i*) ;; *) return 0 ;; esac
case "$TERM" in dumb) return 0 ;; esac
[ -n "$__TAI_LOADED" ] && return 0
__TAI_LOADED=1

__tai_osc133() { printf '\033]133;%s\007' "$1"; }

# Emit OSC 6973 with a hex-encoded JSON payload. Uses xxd or od depending on
# what's available; both are typically present on bash-supporting systems.
__tai_osc6973() {
  local json="$1"
  local hex
  if command -v xxd >/dev/null 2>&1; then
    hex=$(printf '%s' "$json" | xxd -p -c 99999 | tr -d '\n')
  else
    hex=$(printf '%s' "$json" | od -An -tx1 | tr -d ' \n')
  fi
  printf '\033]6973;%s\007' "$hex"
}

# Best-effort JSON string escape (handles ", \, control chars).
__tai_json_escape() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\n'/\\n}"
  s="${s//$'\r'/\\r}"
  s="${s//$'\t'/\\t}"
  printf '%s' "$s"
}

__tai_user_pc="${PROMPT_COMMAND}"
__tai_cmd_start_ms=0
__tai_last_command=""

__tai_now_ms() {
  if [ -n "$EPOCHREALTIME" ]; then
    # EPOCHREALTIME = "1717200000.123456"; convert to ms.
    local s="${EPOCHREALTIME%.*}"
    local us="${EPOCHREALTIME#*.}"
    us="${us:0:3}"
    printf '%s%s' "$s" "$us"
  else
    # Fallback: second resolution.
    printf '%s000' "$(date +%s)"
  fi
}

__tai_preexec() {
  __tai_last_command="$1"
  __tai_cmd_start_ms=$(__tai_now_ms)
  local cmd_esc
  cmd_esc=$(__tai_json_escape "$1")
  __tai_osc6973 "{\"hook\":\"preexec\",\"command\":\"$cmd_esc\"}"
}

# Use the DEBUG trap to get the command string. Skip when the trap fires for
# PROMPT_COMMAND itself (BASH_COMMAND will match our wrapper function name).
trap '__tai_debug_trap "$BASH_COMMAND"' DEBUG
__tai_in_prompt=1
__tai_debug_trap() {
  [ "$__tai_in_prompt" = "1" ] && return
  case "$1" in
    __tai_prompt_invoke*|__tai_preexec*|__tai_debug_trap*) return ;;
  esac
  [ -n "$__tai_preexec_fired" ] && return
  __tai_preexec_fired=1
  __tai_preexec "$1"
}

__tai_prompt_invoke() {
  local __ec=$?
  local __end_ms duration_ms
  __end_ms=$(__tai_now_ms)
  if [ "$__tai_cmd_start_ms" -gt 0 ]; then
    duration_ms=$((__end_ms - __tai_cmd_start_ms))
  else
    duration_ms=0
  fi

  __tai_osc133 "D;$__ec"

  if [ -n "$__tai_preexec_fired" ]; then
    local cwd_esc cmd_esc signal
    cwd_esc=$(__tai_json_escape "$PWD")
    cmd_esc=$(__tai_json_escape "$__tai_last_command")
    # Bash sets $? to 128+signo when terminated by signal; otherwise null.
    if [ "$__ec" -gt 128 ] 2>/dev/null && [ "$__ec" -lt 165 ] 2>/dev/null; then
      signal="\"SIG$((__ec - 128))\""
    else
      signal="null"
    fi
    __tai_osc6973 "{\"hook\":\"precmd\",\"exit\":$__ec,\"signal\":$signal,\"duration_ms\":$duration_ms,\"command\":\"$cmd_esc\",\"cwd\":\"$cwd_esc\"}"
  fi

  __tai_osc133 "A"
  __tai_preexec_fired=
  __tai_cmd_start_ms=0
  __tai_in_prompt=1

  if [ -n "$__tai_user_pc" ]; then
    eval "$__tai_user_pc"
  fi
  if [ -z "$PS1" ]; then
    __tai_osc133 "B"
  else
    case "$PS1" in
      *'\[\033]133;B\007\]'*) ;;
      *) PS1="${PS1}"'\[\033]133;B\007\]' ;;
    esac
  fi
}

# PS0 expands after Enter but before bash runs the command — used for OSC 133;C.
# We also unset __tai_in_prompt here so the DEBUG trap will fire for the
# user's command.
PS0=$'\e]133;C\a$(__tai_in_prompt=0; :)'
PROMPT_COMMAND="__tai_prompt_invoke"

export TAI_SHELL_INTEGRATION=1
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
npx vitest run tests/unit/taiBashIntegration.test.ts
```

Expected: PASS. The script emits one `preexec` (when bash hits the DEBUG trap for `echo hi`) and one `precmd` (when the next prompt fires) per command.

- [ ] **Step 6: Manual sanity check**

```bash
bash -i -c 'source electron/shell-integration/tai-bash.sh; echo hello; ls /nonexistent 2>/dev/null; exit' | cat -v | grep -o '6973;[0-9a-f]*' | head -4
```

Expected: at least 4 OSC 6973 emissions — preexec + precmd for `echo`, preexec + precmd for `ls`.

- [ ] **Step 7: Commit**

```bash
git add electron/shell-integration/tai-bash.sh tests/unit/taiBashIntegration.test.ts
git commit -m "feat(shell-integration): emit OSC 6973 hooks from tai-bash.sh"
```

---

## Task 3: Emit OSC 6973 from tai-zsh.zsh

**Files:**
- Modify: `electron/shell-integration/tai-zsh.zsh`
- Test: `tests/unit/taiZshIntegration.test.ts` (create if absent; mirror Task 2's pattern)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/taiZshIntegration.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import { parseOsc6973 } from '@/utils/osc6973';

const ZSH_AVAILABLE = spawnSync('zsh', ['--version']).status === 0;

describe.skipIf(!ZSH_AVAILABLE)('tai-zsh.zsh OSC 6973 emission', () => {
  it('emits preexec and precmd hooks around a command', () => {
    const result = spawnSync('zsh', ['-i', '-c',
      'source electron/shell-integration/tai-zsh.zsh; echo hi; exit'
    ], { encoding: 'utf8' });
    const stdout = result.stdout;
    const re = /\x1b\]6973;([0-9a-f]+)\x07/g;
    const hooks = [];
    let m;
    while ((m = re.exec(stdout)) !== null) {
      const parsed = parseOsc6973(m[1]);
      if (parsed) hooks.push(parsed);
    }
    expect(hooks.some(h => h.hook === 'preexec' && h.command.includes('echo hi'))).toBe(true);
    expect(hooks.some(h => h.hook === 'precmd' && h.exit === 0)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run tests/unit/taiZshIntegration.test.ts
```

Expected: FAIL (zsh present) or SKIP (zsh absent — install with your package manager and re-run).

- [ ] **Step 3: Modify tai-zsh.zsh**

Replace `electron/shell-integration/tai-zsh.zsh` with:

```zsh
# tai shell integration for zsh — OSC 133 + OSC 6973 sidechannel.
[[ -o interactive ]] || return 0
[[ "$TERM" == "dumb" ]] && return 0

__tai_osc133() { print -nu1 $'\e]133;'"$1"$'\a'; }

__tai_osc6973() {
  local json="$1"
  local hex
  if (( $+commands[xxd] )); then
    hex=$(printf '%s' "$json" | xxd -p -c 99999 | tr -d '\n')
  else
    hex=$(printf '%s' "$json" | od -An -tx1 | tr -d ' \n')
  fi
  print -nu1 $'\e]6973;'"$hex"$'\a'
}

__tai_json_escape() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\n'/\\n}"
  s="${s//$'\r'/\\r}"
  s="${s//$'\t'/\\t}"
  print -nr -- "$s"
}

typeset -g __TAI_CMD_START_MS=0
typeset -g __TAI_LAST_CMD=""

__tai_now_ms() {
  zmodload zsh/datetime 2>/dev/null
  if (( ${+EPOCHREALTIME} )); then
    local s="${EPOCHREALTIME%.*}"
    local us="${EPOCHREALTIME#*.}"
    us="${us:0:3}"
    print -n "${s}${us}"
  else
    print -n "$(date +%s)000"
  fi
}

__tai_preexec() {
  __TAI_LAST_CMD="$1"
  __TAI_CMD_START_MS=$(__tai_now_ms)
  local cmd_esc
  cmd_esc=$(__tai_json_escape "$1")
  __tai_osc6973 "{\"hook\":\"preexec\",\"command\":\"$cmd_esc\"}"
  __tai_osc133 "C"
  __TAI_CMD_ACTIVE=1
}

__tai_precmd() {
  local __ec=$?
  local end_ms duration_ms cwd_esc cmd_esc signal
  end_ms=$(__tai_now_ms)
  if (( __TAI_CMD_START_MS > 0 )); then
    duration_ms=$((end_ms - __TAI_CMD_START_MS))
  else
    duration_ms=0
  fi

  if [[ -n "$__TAI_CMD_ACTIVE" ]]; then
    __tai_osc133 "D;$__ec"
    cwd_esc=$(__tai_json_escape "$PWD")
    cmd_esc=$(__tai_json_escape "$__TAI_LAST_CMD")
    if (( __ec > 128 && __ec < 165 )); then
      signal="\"SIG$((__ec - 128))\""
    else
      signal="null"
    fi
    __tai_osc6973 "{\"hook\":\"precmd\",\"exit\":$__ec,\"signal\":$signal,\"duration_ms\":$duration_ms,\"command\":\"$cmd_esc\",\"cwd\":\"$cwd_esc\"}"
    __TAI_CMD_ACTIVE=
  fi

  __tai_osc133 "A"
  __TAI_CMD_START_MS=0

  if [[ "$PS1" != *$'\e]133;B\a'* ]]; then
    PS1=$'%{\e]133;B\a%}'"$PS1"
  fi
}

autoload -Uz add-zsh-hook 2>/dev/null
if (( $+functions[add-zsh-hook] )); then
  add-zsh-hook precmd __tai_precmd
  add-zsh-hook preexec __tai_preexec
else
  precmd_functions+=(__tai_precmd)
  preexec_functions+=(__tai_preexec)
fi

if [[ "$PS1" != *$'\e]133;B\a'* ]]; then
  PS1=$'%{\e]133;B\a%}'"$PS1"
fi

export TAI_SHELL_INTEGRATION=1
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run tests/unit/taiZshIntegration.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/shell-integration/tai-zsh.zsh tests/unit/taiZshIntegration.test.ts
git commit -m "feat(shell-integration): emit OSC 6973 hooks from tai-zsh.zsh"
```

---

## Task 4: Emit OSC 6973 from tai-fish.fish

**Files:**
- Modify: `electron/shell-integration/tai-fish.fish`
- Test: `tests/unit/taiFishIntegration.test.ts` (new, mirror Task 3's pattern)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/taiFishIntegration.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import { parseOsc6973 } from '@/utils/osc6973';

const FISH_AVAILABLE = spawnSync('fish', ['--version']).status === 0;

describe.skipIf(!FISH_AVAILABLE)('tai-fish.fish OSC 6973 emission', () => {
  it('emits preexec and precmd hooks around a command', () => {
    const result = spawnSync('fish', ['-i', '-c',
      'source electron/shell-integration/tai-fish.fish; echo hi; exit'
    ], { encoding: 'utf8' });
    const stdout = result.stdout;
    const re = /\x1b\]6973;([0-9a-f]+)\x07/g;
    const hooks = [];
    let m;
    while ((m = re.exec(stdout)) !== null) {
      const parsed = parseOsc6973(m[1]);
      if (parsed) hooks.push(parsed);
    }
    expect(hooks.some(h => h.hook === 'preexec' && h.command.includes('echo hi'))).toBe(true);
    expect(hooks.some(h => h.hook === 'precmd' && h.exit === 0)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run tests/unit/taiFishIntegration.test.ts
```

Expected: FAIL or SKIP.

- [ ] **Step 3: Modify tai-fish.fish**

Replace `electron/shell-integration/tai-fish.fish` with:

```fish
# tai shell integration for fish — OSC 133 + OSC 6973 sidechannel.
status is-interactive; or exit 0
test "$TERM" = dumb; and exit 0

function __tai_osc133
    printf '\e]133;%s\a' $argv[1]
end

function __tai_osc6973
    set -l json $argv[1]
    set -l hex
    if command -v xxd >/dev/null 2>&1
        set hex (printf '%s' $json | xxd -p -c 99999 | tr -d '\n')
    else
        set hex (printf '%s' $json | od -An -tx1 | tr -d ' \n')
    end
    printf '\e]6973;%s\a' $hex
end

function __tai_json_escape
    set -l s $argv[1]
    set s (string replace -a '\\' '\\\\' $s)
    set s (string replace -a '"' '\\"' $s)
    set s (string replace -a \n '\\n' $s)
    set s (string replace -a \r '\\r' $s)
    set s (string replace -a \t '\\t' $s)
    printf '%s' $s
end

set -g __TAI_CMD_START_MS 0
set -g __TAI_LAST_CMD ""
set -g __TAI_LAST_STATUS 0

function __tai_now_ms
    set -l s (date +%s%3N 2>/dev/null)
    if test -n "$s"
        printf '%s' $s
    else
        printf '%s000' (date +%s)
    end
end

function __tai_preexec --on-event fish_preexec
    set -g __TAI_LAST_CMD $argv[1]
    set -g __TAI_CMD_START_MS (__tai_now_ms)
    set -l cmd_esc (__tai_json_escape $argv[1])
    __tai_osc6973 "{\"hook\":\"preexec\",\"command\":\"$cmd_esc\"}"
    __tai_osc133 C
    set -g __TAI_CMD_ACTIVE 1
end

function __tai_postexec --on-event fish_postexec
    set -g __TAI_LAST_STATUS $status
end

function __tai_prompt_start --on-event fish_prompt
    if set -q __TAI_CMD_ACTIVE
        set -l end_ms (__tai_now_ms)
        set -l duration_ms 0
        if test $__TAI_CMD_START_MS -gt 0
            set duration_ms (math $end_ms - $__TAI_CMD_START_MS)
        end
        __tai_osc133 "D;$__TAI_LAST_STATUS"
        set -l cwd_esc (__tai_json_escape $PWD)
        set -l cmd_esc (__tai_json_escape $__TAI_LAST_CMD)
        set -l signal "null"
        if test $__TAI_LAST_STATUS -gt 128 -a $__TAI_LAST_STATUS -lt 165
            set signal "\"SIG"(math $__TAI_LAST_STATUS - 128)"\""
        end
        __tai_osc6973 "{\"hook\":\"precmd\",\"exit\":$__TAI_LAST_STATUS,\"signal\":$signal,\"duration_ms\":$duration_ms,\"command\":\"$cmd_esc\",\"cwd\":\"$cwd_esc\"}"
        set -e __TAI_CMD_ACTIVE
    end
    __tai_osc133 A
    set -g __TAI_CMD_START_MS 0
end

if not functions -q __tai_orig_fish_prompt
    functions -c fish_prompt __tai_orig_fish_prompt
    function fish_prompt
        __tai_orig_fish_prompt
        __tai_osc133 B
    end
end

set -gx TAI_SHELL_INTEGRATION 1
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run tests/unit/taiFishIntegration.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/shell-integration/tai-fish.fish tests/unit/taiFishIntegration.test.ts
git commit -m "feat(shell-integration): emit OSC 6973 hooks from tai-fish.fish"
```

---

## Task 5: Parse OSC 6973 in BlockSegmenter

**Files:**
- Modify: `src/components/BlockSegmenter.ts`
- Modify: `src/types.ts`
- Test: `tests/unit/blockSegmenterHooks.test.ts`

- [ ] **Step 1: Extend the SegmentedBlock type**

Edit `src/types.ts`. Find the `SegmentedBlock` interface and add these fields:

```typescript
// Add to existing SegmentedBlock interface (don't replace it):
//   signal?: string | null;       // e.g. "SIG15"; null when exit was clean
//   cwd?: string;                 // post-exec cwd from precmd hook
//   commandFromShell?: string;    // command as shell saw it (post-alias)
//   hooksAvailable?: boolean;     // true iff this block had an OSC 6973 precmd
```

If the existing interface is in a different file, locate it via:
```bash
grep -rn "interface SegmentedBlock" src/
```

- [ ] **Step 2: Write the failing test**

Create `tests/unit/blockSegmenterHooks.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { BlockSegmenter } from '@/components/BlockSegmenter';
import { encodeOsc6973 } from '@/utils/osc6973';

function osc133(letter: string) {
  return `\x1b]133;${letter}\x07`;
}

describe('BlockSegmenter OSC 6973 enrichment', () => {
  it('attaches signal/cwd/commandFromShell from precmd hook', () => {
    const seg = new BlockSegmenter();
    const blocks: any[] = [];
    seg.onBlock(b => blocks.push(b));

    seg.feed(osc133('A'));
    seg.feed('mike@host:~$ ');
    seg.feed(osc133('B'));
    seg.feed(encodeOsc6973({ hook: 'preexec', command: 'git status' }));
    seg.feed('git status\n');
    seg.feed(osc133('C'));
    seg.feed('On branch master\n');
    seg.feed(osc133('D;0'));
    seg.feed(encodeOsc6973({
      hook: 'precmd',
      exit: 0,
      signal: null,
      duration_ms: 42,
      command: 'git status',
      cwd: '/home/m/code/tai',
    }));
    seg.feed(osc133('A'));
    seg.feed('mike@host:~$ ');
    seg.feed(osc133('B'));

    expect(blocks).toHaveLength(1);
    expect(blocks[0].commandFromShell).toBe('git status');
    expect(blocks[0].cwd).toBe('/home/m/code/tai');
    expect(blocks[0].signal).toBeNull();
    expect(blocks[0].hooksAvailable).toBe(true);
    expect(blocks[0].exitCode).toBe(0);
  });

  it('still segments when OSC 6973 is absent (hooksAvailable=false)', () => {
    const seg = new BlockSegmenter();
    const blocks: any[] = [];
    seg.onBlock(b => blocks.push(b));

    seg.feed(osc133('A') + '$ ' + osc133('B') + 'ls\n' + osc133('C') + 'a b c\n' + osc133('D;0') + osc133('A') + '$ ' + osc133('B'));
    expect(blocks).toHaveLength(1);
    expect(blocks[0].hooksAvailable).toBe(false);
  });

  it('ignores malformed OSC 6973 payloads', () => {
    const seg = new BlockSegmenter();
    const blocks: any[] = [];
    seg.onBlock(b => blocks.push(b));

    seg.feed(osc133('A') + '$ ' + osc133('B'));
    seg.feed('\x1b]6973;zzznotvalidhex\x07');
    seg.feed(osc133('C') + 'output\n' + osc133('D;1') + osc133('A') + '$ ' + osc133('B'));
    expect(blocks).toHaveLength(1);
    expect(blocks[0].exitCode).toBe(1);
    expect(blocks[0].hooksAvailable).toBe(false);
  });
});
```

- [ ] **Step 2a: Run the test to verify it fails**

```bash
npx vitest run tests/unit/blockSegmenterHooks.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Add OSC 6973 parsing to BlockSegmenter**

Edit `src/components/BlockSegmenter.ts`. Near the top with other regexes, add:

```typescript
import { parseOsc6973 } from '@/utils/osc6973';

const OSC6973_RE = /\x1b\]6973;([^\x07\x1b]*)(?:\x07|\x1b\\)/g;
```

Add private fields to the class (next to `_osc133*` fields):

```typescript
private _pendingPreexec: { command: string } | null = null;
private _pendingPrecmd: {
  exit: number;
  signal: string | null;
  duration_ms: number;
  command: string;
  cwd: string;
} | null = null;
```

Modify `feed()` to consume OSC 6973 before OSC 133. Replace the existing `feed` body with:

```typescript
feed(rawData: string): void {
  if (rawData.includes('\x1b]6973;')) {
    rawData = this._consumeOsc6973(rawData);
    if (!rawData) return;
  }
  if (rawData.includes('\x1b]133;')) {
    rawData = this._consumeOsc133(rawData);
    if (!rawData) return;
  }
  if (this._integrationActive) {
    this._feedIntegrated(rawData);
    return;
  }
  this._feedLegacy(rawData);
}
```

Add the consumer method (next to `_consumeOsc133`):

```typescript
private _consumeOsc6973(rawData: string): string {
  OSC6973_RE.lastIndex = 0;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  const pieces: string[] = [];
  while ((match = OSC6973_RE.exec(rawData)) !== null) {
    pieces.push(rawData.slice(lastIndex, match.index));
    const parsed = parseOsc6973(match[1]);
    if (parsed) {
      if (parsed.hook === 'preexec') {
        this._pendingPreexec = { command: parsed.command };
      } else if (parsed.hook === 'precmd') {
        this._pendingPrecmd = {
          exit: parsed.exit,
          signal: parsed.signal,
          duration_ms: parsed.duration_ms,
          command: parsed.command,
          cwd: parsed.cwd,
        };
      }
    }
    lastIndex = OSC6973_RE.lastIndex;
  }
  pieces.push(rawData.slice(lastIndex));
  return pieces.join('');
}
```

Modify `_finalizeIntegratedBlock` to attach the hook metadata. Find the line where `block: SegmentedBlock = { ... }` is constructed and replace it with:

```typescript
const block: SegmentedBlock = {
  id: this._nextId(),
  command,
  output,
  rawOutput,
  promptText,
  startTime: this._osc133BlockStart || Date.now(),
  duration: this._pendingPrecmd?.duration_ms ?? (Date.now() - (this._osc133BlockStart || Date.now())),
  isRemote: this._isRemotePrompt(promptText),
  hooksAvailable: !!this._pendingPrecmd,
  ...(this._osc133ExitCode !== null ? { exitCode: this._osc133ExitCode } : {}),
  ...(this._pendingPrecmd ? {
    signal: this._pendingPrecmd.signal,
    cwd: this._pendingPrecmd.cwd,
    commandFromShell: this._pendingPrecmd.command,
  } : {}),
};
```

After the block is fired (after the `_blockCallbacks.forEach(...)` line in `_finalizeIntegratedBlock`), clear hook state:

```typescript
this._pendingPreexec = null;
this._pendingPrecmd = null;
```

Also clear them in `reset()`:

```typescript
this._pendingPreexec = null;
this._pendingPrecmd = null;
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run tests/unit/blockSegmenterHooks.test.ts
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Run the full segmenter test suite**

```bash
npx vitest run tests/unit/BlockSegmenter.test.ts tests/unit/blockSegmenterHooks.test.ts
```

Expected: PASS. If existing tests fail, the new code path is interfering — fix before continuing.

- [ ] **Step 6: Commit**

```bash
git add src/components/BlockSegmenter.ts src/types.ts tests/unit/blockSegmenterHooks.test.ts
git commit -m "feat(segmenter): parse OSC 6973 hooks and enrich blocks"
```

---

## Task 6: Termios poller (main process)

**Files:**
- Create: `electron/services/termiosPoller.ts`
- Test: `tests/unit/termiosPoller.test.ts`
- Modify: `package.json` (add dependency)

- [ ] **Step 1: Add the termios dependency**

```bash
npm install node-termios
```

If `node-termios` fails to install or build on this platform, fall back to writing a minimal N-API addon under `electron/native/termios/` — but try the npm package first. The poller's public API will be the same either way.

- [ ] **Step 2: Write the failing test**

Create `tests/unit/termiosPoller.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TermiosPoller } from '@/../electron/services/termiosPoller';

describe('TermiosPoller', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('does not poll until start() is called', () => {
    const read = vi.fn().mockReturnValue({ echo: true, icanon: true });
    const onChange = vi.fn();
    new TermiosPoller(123, read, onChange);
    vi.advanceTimersByTime(5000);
    expect(read).not.toHaveBeenCalled();
  });

  it('fires onChange when ECHO transitions off (and ICANON stays on)', () => {
    const states = [
      { echo: true, icanon: true },
      { echo: true, icanon: true },
      { echo: false, icanon: true },
    ];
    let i = 0;
    const read = vi.fn(() => states[Math.min(i++, states.length - 1)]);
    const onChange = vi.fn();
    const p = new TermiosPoller(123, read, onChange);
    p.start();
    vi.advanceTimersByTime(1000); // 1st poll: echo on -> no event (baseline)
    vi.advanceTimersByTime(1000); // 2nd poll: no change
    vi.advanceTimersByTime(1000); // 3rd poll: echo off -> event
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith({ echo: false, icanon: true, passwordPrompt: true });
  });

  it('does not flag passwordPrompt when ICANON is also off (vim-style raw mode)', () => {
    const read = vi.fn()
      .mockReturnValueOnce({ echo: true, icanon: true })
      .mockReturnValue({ echo: false, icanon: false });
    const onChange = vi.fn();
    const p = new TermiosPoller(123, read, onChange);
    p.start();
    vi.advanceTimersByTime(1000);
    vi.advanceTimersByTime(1000);
    expect(onChange).toHaveBeenCalledWith({ echo: false, icanon: false, passwordPrompt: false });
  });

  it('stop() halts the poll loop', () => {
    const read = vi.fn().mockReturnValue({ echo: true, icanon: true });
    const p = new TermiosPoller(123, read, vi.fn());
    p.start();
    vi.advanceTimersByTime(1000);
    p.stop();
    const callsBefore = read.mock.calls.length;
    vi.advanceTimersByTime(5000);
    expect(read.mock.calls.length).toBe(callsBefore);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
npx vitest run tests/unit/termiosPoller.test.ts
```

Expected: FAIL.

- [ ] **Step 4: Implement TermiosPoller**

Create `electron/services/termiosPoller.ts`:

```typescript
export interface TermiosState {
  echo: boolean;
  icanon: boolean;
}

export interface EchoChangeEvent extends TermiosState {
  passwordPrompt: boolean;
}

export type TermiosReader = (fd: number) => TermiosState;
export type ChangeHandler = (e: EchoChangeEvent) => void;

const POLL_INTERVAL_MS = 1000;

export class TermiosPoller {
  private _timer: ReturnType<typeof setInterval> | null = null;
  private _last: TermiosState | null = null;

  constructor(
    private _fd: number,
    private _read: TermiosReader,
    private _onChange: ChangeHandler,
  ) {}

  start(): void {
    if (this._timer) return;
    this._last = null;
    this._timer = setInterval(() => this._tick(), POLL_INTERVAL_MS);
  }

  stop(): void {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  private _tick(): void {
    let state: TermiosState;
    try {
      state = this._read(this._fd);
    } catch {
      return;
    }
    if (this._last === null) {
      this._last = state;
      return;
    }
    if (state.echo === this._last.echo && state.icanon === this._last.icanon) {
      return;
    }
    this._last = state;
    this._onChange({
      echo: state.echo,
      icanon: state.icanon,
      // Warp's heuristic: ICANON on + ECHO off = password prompt.
      passwordPrompt: !state.echo && state.icanon,
    });
  }
}

// Real reader, used in production. Wraps node-termios.
export function defaultTermiosReader(): TermiosReader {
  // Lazy require so test environments without the native module can still load
  // the file and inject a mock reader.
  const termios = require('node-termios');
  return (fd: number) => {
    const t = new termios.Termios(fd);
    return {
      echo: (t.c_lflag & termios.native.constants.ECHO) !== 0,
      icanon: (t.c_lflag & termios.native.constants.ICANON) !== 0,
    };
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
npx vitest run tests/unit/termiosPoller.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add electron/services/termiosPoller.ts tests/unit/termiosPoller.test.ts package.json package-lock.json
git commit -m "feat(termios): 1Hz poller with !ECHO && ICANON password-prompt heuristic"
```

---

## Task 7: Wire termios poller into pty service

**Files:**
- Modify: `electron/services/pty.ts`
- Modify: `electron/preload.ts`

- [ ] **Step 1: Wire the poller into pty.ts**

Edit `electron/services/pty.ts`. At the top, add:

```typescript
import { TermiosPoller, defaultTermiosReader } from './termiosPoller';
```

Find the section where a new pty is created (`pty.spawn(...)`). Immediately after `const term = pty.spawn(...)`, get its master fd. node-pty exposes the fd via `(term as any)._fd` on Unix; capture it defensively:

```typescript
const masterFd: number | undefined = (term as unknown as { _fd?: number })._fd;
```

Add poller construction (still inside the pty creation block, after `term` is registered in whatever map holds pty state):

```typescript
let poller: TermiosPoller | null = null;
if (process.platform !== 'win32' && typeof masterFd === 'number') {
  try {
    const reader = defaultTermiosReader();
    poller = new TermiosPoller(masterFd, reader, (e) => {
      const win = /* the BrowserWindow / WebContents for this session;
                     use whatever the existing code uses to fire pty:data */;
      win?.webContents.send('pty:echo-change', id, {
        echo: e.echo,
        icanon: e.icanon,
        passwordPrompt: e.passwordPrompt,
      });
    });
  } catch (err) {
    // node-termios failed to load — log and continue without password detection.
    console.warn('[pty] termios poller unavailable:', err);
  }
}
```

Store `poller` alongside the term in whatever map already holds per-pty state (look for the existing pattern that holds `term` and add a sibling).

Find the existing OSC 133 `C` / `D` event paths — `pty.ts` already routes `pty:data` to the renderer. We need to start the poller when a block becomes active and stop when it ends. The cleanest hook is in the renderer (which knows OSC 133 state via the segmenter), but to keep main-process control we'll start/stop based on IPC commands from the renderer. Add IPC handlers:

```typescript
ipcMain.on('pty:start-echo-poll', (_event, id: number) => {
  const entry = /* existing per-pty map */.get(id);
  entry?.poller?.start();
});
ipcMain.on('pty:stop-echo-poll', (_event, id: number) => {
  const entry = /* existing per-pty map */.get(id);
  entry?.poller?.stop();
});
```

In the existing pty kill / exit handler, also call `poller?.stop()`.

- [ ] **Step 2: Expose IPC in preload**

Edit `electron/preload.ts`. In the `pty:` object exposed via `contextBridge`:

```typescript
startEchoPoll: (id: number) => ipcRenderer.send('pty:start-echo-poll', id),
stopEchoPoll: (id: number) => ipcRenderer.send('pty:stop-echo-poll', id),
onEchoChange: (callback: (id: number, e: { echo: boolean; icanon: boolean; passwordPrompt: boolean }) => void) => {
  const listener = (_event: Electron.IpcRendererEvent, id: number, e: any) => callback(id, e);
  ipcRenderer.on('pty:echo-change', listener);
  return () => ipcRenderer.removeListener('pty:echo-change', listener);
},
```

If TAI uses a typed `window.tai.pty` interface declaration (look in `src/types/` or `src/global.d.ts`), update it to include the new methods.

- [ ] **Step 3: Manual smoke test**

```bash
npm run dev
```

In the app, open a terminal tab and run:
```
sudo -k; sudo true
```
Expected (from main process logs / devtools console after wiring the renderer in Task 8): an `echo-change` event with `passwordPrompt: true` fires within ~1s of sudo asking for the password.

Note: the renderer-side handler doesn't exist yet — for this task, verify by adding a temporary `console.log` to the IPC sender in pty.ts and watching main-process logs.

- [ ] **Step 4: Commit**

```bash
git add electron/services/pty.ts electron/preload.ts
git commit -m "feat(pty): plumb termios echo-change events to renderer"
```

---

## Task 8: Renderer subscribes to echo events; password mode is card-attached

**Files:**
- Modify: `src/components/TerminalSession.tsx`
- Modify: `src/components/BlockSegmenter.ts`

- [ ] **Step 1: Add a block-active hook to BlockSegmenter**

`TerminalSession` needs to know when a block transitions active/inactive so it can call `startEchoPoll`/`stopEchoPoll`. The segmenter already tracks this via `_commandActive`. Expose it as a callback.

Edit `src/components/BlockSegmenter.ts`. Add:

```typescript
type BlockActiveCallback = (active: boolean) => void;
// ...inside the class:
private _blockActiveCallbacks: BlockActiveCallback[] = [];
onBlockActive(cb: BlockActiveCallback): void { this._blockActiveCallbacks.push(cb); }

private _setCommandActive(active: boolean): void {
  if (this._commandActive === active) return;
  this._commandActive = active;
  this._blockActiveCallbacks.forEach(cb => cb(active));
}
```

Replace the two existing assignments `this._commandActive = true;` and `this._commandActive = false;` (in `_handleOsc133Marker` cases `C` and `D`, and in `_finalizeIntegratedBlock`) with `this._setCommandActive(true)` / `this._setCommandActive(false)`.

Also clear `_blockActiveCallbacks = []` in `reset()`.

- [ ] **Step 2: Subscribe in TerminalSession**

Edit `src/components/TerminalSession.tsx`. Where the segmenter is initialized (look for `segmenter.onAltScreen(...)` near line ~330), add:

```typescript
segmenter.onBlockActive((active) => {
  if (active) {
    window.tai?.pty?.startEchoPoll(ptyId);
  } else {
    window.tai?.pty?.stopEchoPoll(ptyId);
    setPasswordPrompt(false);  // safety: block ended, drop password UI
  }
});

const unsubEcho = window.tai?.pty?.onEchoChange?.((evtId, e) => {
  if (evtId !== ptyId) return;
  if (e.passwordPrompt) {
    setPasswordPrompt(true);
  } else if (!e.passwordPrompt && passwordPromptRef.current) {
    setPasswordPrompt(false);
  }
});
```

Add `passwordPromptRef` to mirror `passwordPrompt` state (existing code likely already has the pattern; if not, add `const passwordPromptRef = useRef(false); passwordPromptRef.current = passwordPrompt;`).

In the cleanup callback for the `useEffect` that holds the segmenter wiring, call `unsubEcho?.();`.

Find the existing `segmenter.onPasswordPrompt(() => { setPasswordPrompt(true); });` registration — leave it as a fallback for sessions where the termios poller failed to load, but add a guard so it only fires when no echo event has been received this block. Simplest: rely on the segmenter's existing `_passwordPromptFired` flag — both code paths set it, so the legacy regex path is naturally suppressed once the echo path has triggered.

- [ ] **Step 3: Manual verification**

```bash
npm run dev
```

In the app: open a terminal, run `sudo -k`, then `sudo true`. The password prompt should appear within ~1s. Compare against the previous behavior (regex match on "Password:"). Try a command that prints the word "password" without disabling echo:

```bash
echo "Enter password: but don't actually"
```

Expected: no password UI appears (the regex would have false-positived here; the termios path doesn't).

Also verify `vim` does NOT trigger the password UI (vim disables both ECHO and ICANON; our heuristic correctly skips it).

- [ ] **Step 4: Commit**

```bash
git add src/components/BlockSegmenter.ts src/components/TerminalSession.tsx
git commit -m "feat(terminal): drive password prompt from termios echo events"
```

---

## Task 9: CommandBlock body-mode state machine

**Files:**
- Modify: `src/components/CommandBlock.tsx`
- Modify: `src/types.ts` (add `BlockBodyMode` type)

- [ ] **Step 1: Define the BlockBodyMode type**

Edit `src/types.ts`:

```typescript
export type BlockBodyMode = 'output' | 'interactive' | 'password';
```

- [ ] **Step 2: Read the existing CommandBlock to understand its layout**

```bash
cat src/components/CommandBlock.tsx | head -100
```

Identify where the output body is rendered (likely a `<pre>` or scrolling container) and where the existing per-block flags (exit code badge, etc.) live.

- [ ] **Step 3: Add bodyMode prop and switch rendering**

Edit `src/components/CommandBlock.tsx`. Add `bodyMode` to the props interface:

```typescript
interface CommandBlockProps {
  // ...existing props
  bodyMode?: BlockBodyMode;     // default 'output'
  ptyId?: number;               // required when bodyMode === 'password' or 'interactive'
  onPasswordDone?: () => void;
}
```

In the render function, switch on `bodyMode`. Replace the existing output-body JSX with:

```typescript
{bodyMode === 'password' && ptyId !== undefined ? (
  <PasswordPrompt ptyId={ptyId} onDone={onPasswordDone ?? (() => {})} />
) : bodyMode === 'interactive' ? (
  // For v1, interactive mode just hides the rendered output and shows a
  // placeholder. The shared alt-screen xterm view in TerminalSession.tsx
  // (existing) handles the actual rendering. Task 11 will replace this with
  // a per-card xterm.
  <div className={styles.interactivePlaceholder}>(interactive program running…)</div>
) : (
  /* existing output body */
)}
```

Import `PasswordPrompt` and `BlockBodyMode` at the top.

- [ ] **Step 4: Pass bodyMode from BlockList → CommandBlock**

Edit `src/components/BlockList.tsx` (and `TerminalSession.tsx` wherever blocks are rendered). The active-block id needs tracking. In `TerminalSession.tsx`, add:

```typescript
const [activeBlockId, setActiveBlockId] = useState<string | null>(null);
// In segmenter.onBlockActive:
//   when active=true: activeBlockId = the id of the block-about-to-be (use a
//   placeholder id like 'pending' since the block hasn't been finalized yet,
//   then swap to the real id when onBlock fires).
// when active=false: activeBlockId = null.
```

When passing to `CommandBlock`, compute:

```typescript
const bodyMode: BlockBodyMode =
  block.id === activeBlockId && passwordPrompt ? 'password'
  : block.id === activeBlockId && interactiveMode ? 'interactive'
  : 'output';
```

This wiring is fiddly because TAI currently finalizes a block at OSC 133 D, but the password prompt fires during the running command. The simplest model: render a "pending" card while the block is active (no SegmentedBlock yet — synthesize one from `_pendingPreexec.command`), and replace it with the finalized block at OSC 133 D. Check if the existing code already has a pending-block concept (grep for `pending` in `TerminalSession.tsx`).

If not, add minimal pending-card state:

```typescript
const [pendingBlock, setPendingBlock] = useState<{ id: string; command: string } | null>(null);

segmenter.onBlockActive((active) => {
  if (active) {
    const command = /* expose _pendingPreexec.command via a new segmenter getter */;
    setPendingBlock({ id: 'pending-' + Date.now(), command });
    setActiveBlockId(/* the id you just generated */);
  } else {
    setPendingBlock(null);
    setActiveBlockId(null);
  }
});
```

Expose `get pendingCommand(): string` on `BlockSegmenter` returning `this._pendingPreexec?.command ?? ''`.

Render the pending card via the same `CommandBlock` component above the input bar.

- [ ] **Step 5: Manual verification**

```bash
npm run dev
```

Run `sudo true`. Expected:
- A pending card appears immediately, showing `sudo true` as the command.
- Within ~1s, the card's body switches to a password field.
- Type the password; on Enter the password is submitted to the PTY.
- Block finalizes when sudo exits; pending card is replaced by a normal one.

- [ ] **Step 6: Commit**

```bash
git add src/components/CommandBlock.tsx src/components/BlockList.tsx src/components/TerminalSession.tsx src/types.ts
git commit -m "feat(card): body-mode state machine (output | interactive | password)"
```

---

## Task 10: Per-card input — write to PTY stdin while block active

**Files:**
- Modify: `src/components/CommandBlock.tsx`
- Modify: `src/components/TerminalInput.tsx`
- Modify: `src/components/TerminalSession.tsx`

- [ ] **Step 1: Add a card-attached input affordance**

Edit `src/components/CommandBlock.tsx`. When `bodyMode === 'output'` AND the block is the active pending block AND not in password mode, render an inline input below the output body:

```typescript
{isActive && bodyMode === 'output' && ptyId !== undefined && (
  <CardInput ptyId={ptyId} />
)}
```

Define `CardInput` inline at the bottom of `CommandBlock.tsx`:

```typescript
function CardInput({ ptyId }: { ptyId: number }) {
  const [value, setValue] = useState('');
  return (
    <input
      className={styles.cardInput}
      value={value}
      onChange={e => setValue(e.target.value)}
      placeholder="…input"
      onKeyDown={e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          window.tai?.pty?.write(ptyId, value + '\n');
          setValue('');
        } else if (e.key === 'c' && e.ctrlKey) {
          e.preventDefault();
          window.tai?.pty?.write(ptyId, '\x03');
        }
      }}
    />
  );
}
```

Add styling for `.cardInput` in `CommandBlock.module.css`:

```css
.cardInput {
  width: 100%;
  margin-top: 8px;
  padding: 6px 10px;
  background: var(--bg-input);
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--text-primary);
}
.cardInput:focus { outline: 1px solid var(--accent); }
```

- [ ] **Step 2: Add `isActive` prop**

Pass `isActive={block.id === activeBlockId}` to `CommandBlock` from wherever it's rendered. Update the prop type to include it.

- [ ] **Step 3: Grey out the global input while a block is active**

Edit `src/components/TerminalInput.tsx`. Add a `disabled` prop. When true:
- Visually grey out (lower opacity, `cursor: not-allowed` on the container).
- Change placeholder text to "Command running… (input goes to the card)".
- Submissions go to the existing queue (already-implemented behavior — verify in code).

In `src/components/TerminalSession.tsx`:

```typescript
<TerminalInput
  // existing props
  disabled={!!pendingBlock && !passwordPrompt}
/>
```

- [ ] **Step 4: Manual verification**

```bash
npm run dev
```

- Run `python -i` (or `node`). Expected: pending card with a card-attached input. Typing into it writes to the python REPL. Global input is greyed out.
- Type `exit()` in the card input. Card finalizes, global input re-enables.
- Run `ls`. Expected: card is born and dies before you see the card input (short-lived command).
- Run `sudo true`. Expected: card input is NOT shown (password mode replaces it).

- [ ] **Step 5: Commit**

```bash
git add src/components/CommandBlock.tsx src/components/CommandBlock.module.css src/components/TerminalInput.tsx src/components/TerminalSession.tsx
git commit -m "feat(card): per-card stdin input; grey out global bar while block active"
```

---

## Task 11: Per-card interactive xterm for alt-screen programs

**Files:**
- Modify: `src/components/CommandBlock.tsx`
- Modify: `src/components/TerminalSession.tsx`
- Modify: `src/components/HiddenXterm.tsx` (or create a new sibling)

**Note:** TAI already has a session-level xterm view that takes over when alt-screen is entered (see `showXterm` / `HiddenXterm.tsx` in `TerminalSession.tsx`). This task moves that xterm view *inside* the active card so a `vim` session looks like it belongs to its block.

- [ ] **Step 1: Read the existing HiddenXterm and showXterm flow**

```bash
cat src/components/HiddenXterm.tsx
grep -n "showXterm\|altScreenVisible" src/components/TerminalSession.tsx
```

Understand how the existing xterm instance is mounted, fed bytes, and resized. The goal is to lift it out of its current position and embed it in the active card when alt-screen is on, then return it to the session-level position when alt-screen ends.

- [ ] **Step 2: Decision: portal vs. ownership transfer**

The xterm.js instance is expensive to create. Two options:
- **A. Portal** — keep xterm mounted at the session level always, but render its DOM via `createPortal` into the active card while alt-screen is active. Single xterm instance; DOM moves.
- **B. Pass-through prop** — `CommandBlock` accepts an optional `xtermContainerRef` it forwards to its inner div; `TerminalSession` reads that ref and mounts xterm into it conditionally.

**Pick A (portal).** Simpler lifecycle, no remounting xterm.

Modify `TerminalSession.tsx`:

```typescript
const xtermPortalTargetRef = useRef<HTMLDivElement | null>(null);

// existing xterm mount logic continues to attach to a top-level container.
// On alt-screen active + activeBlockId set, render the xterm container
// inside the active card via createPortal:

{showXterm && xtermPortalTargetRef.current
  ? createPortal(<HiddenXterm ... />, xtermPortalTargetRef.current)
  : <HiddenXterm ... />  /* mounted at top level when no active card */}
```

In `CommandBlock.tsx`, when `bodyMode === 'interactive' && isActive`, render an empty container and forward its ref up via a callback prop `onInteractiveContainerRef`. `TerminalSession` stores that ref in `xtermPortalTargetRef`.

- [ ] **Step 3: Drive bodyMode from alt-screen state**

Existing `setAltScreenVisible` / `interactiveMode` state should set `bodyMode='interactive'` on the active card. Compute:

```typescript
const cardBodyMode: BlockBodyMode =
  passwordPrompt ? 'password'
  : (altScreenVisible || interactiveMode) ? 'interactive'
  : 'output';
```

Pass to the pending card.

- [ ] **Step 4: Manual verification**

```bash
npm run dev
```

- Run `vim hello.txt`. Expected: vim renders inside the active card's body (not the session-wide overlay). Resize the window — vim re-flows.
- Run `:q`. Card finalizes; xterm container detaches and returns to the session-level mount.
- Run `htop`, `less /etc/passwd`, `claude`. All should render in-card.

- [ ] **Step 5: Visual polish**

The card needs a min-height while interactive so it doesn't visually collapse when xterm is empty. Add in `CommandBlock.module.css`:

```css
.interactiveBody {
  min-height: 240px;
  display: flex;
}
.interactiveBody > * { flex: 1; }
```

- [ ] **Step 6: Commit**

```bash
git add src/components/CommandBlock.tsx src/components/CommandBlock.module.css src/components/TerminalSession.tsx src/components/HiddenXterm.tsx
git commit -m "feat(card): embed alt-screen xterm inside the active card"
```

---

## Task 12: End-to-end manual verification matrix

**Files:** none (verification only).

- [ ] **Step 1: Run the test suite**

```bash
npx vitest run
```

Expected: all tests pass.

- [ ] **Step 2: Verification matrix**

Spin up `npm run dev` and run through this matrix. For each row, confirm the expected behavior; check the box only when verified.

| # | Scenario | Expected |
|---|---|---|
| - [ ] | `ls -la` in bash | Pending card → finalized block; exit 0; no input affordance flashed. |
| - [ ] | `false` in bash | Block finalizes with exit 1; visual error indicator. |
| - [ ] | `sleep 5` in bash | Pending card visible for 5s with card-input shown; global bar greyed. |
| - [ ] | `python -i`, type `1+1`, type `exit()` | Card-input drives REPL; finalizes on exit. |
| - [ ] | `sudo -k && sudo true`, enter password | Password field appears within 1s; submitting succeeds. |
| - [ ] | `echo "Enter password: faketext"` | No password UI (termios path didn't trigger). |
| - [ ] | `vim /tmp/x`, save and quit | vim renders in-card; card finalizes on quit. |
| - [ ] | `htop`, press q | htop renders in-card; finalizes. |
| - [ ] | `less /etc/passwd`, press q | less renders in-card; finalizes. |
| - [ ] | `claude` (interactive) | Renders in-card; card-input works. |
| - [ ] | `ssh localhost`, accept fingerprint, `exit` | Block stays active across ssh session; finalizes on exit. |
| - [ ] | Switch shell to zsh, repeat first 5 rows | Same behavior. |
| - [ ] | Switch shell to fish, repeat first 5 rows | Same behavior. |
| - [ ] | Long-running command (`find / 2>/dev/null`), type into global bar | Input queues, doesn't get sent into find's stdin. |
| - [ ] | Kill the running command with Ctrl-C | OSC 133 D fires with non-zero exit; signal field on block is "SIGINT" (signal 2 → "SIG2"). |

- [ ] **Step 3: Performance smoke**

Run `find / 2>/dev/null` and watch CPU usage. Expected: no significant increase vs. baseline (1Hz termios polling is negligible).

- [ ] **Step 4: Commit verification notes**

If any matrix row fails, file follow-up TODOs in `TODO.md` rather than fixing in this commit (unless trivially fixable).

```bash
git add TODO.md
git commit -m "test: end-to-end verification of card/shell-integration rework" --allow-empty
```

---

## Self-Review

**Spec coverage:**
- §Goal (deterministic blocks, modes, password field): Tasks 1–6 (markers), 7–8 (echo), 9–11 (modes). ✓
- §Shell integration (OSC 6973, three shells): Tasks 1–4. ✓
- §Card body modes (Output | Interactive | PasswordPrompt): Task 9 + Task 11 (interactive embed) + Task 8 (password). ✓
- §Per-card input + global grey-out: Task 10. ✓
- §Testing requirements: Tasks 1–6 unit, Task 12 manual. Integration tests for all 3 shells: Tasks 2/3/4. ✓
- §Risks (termios latency, OSC collision, rc-file edge cases, visual regression): Task 6 (1Hz poll matches Warp; bounded), wire format fixed (Task 1), shell hooks layered atop existing OSC 133 wrappers (Tasks 2–4 preserve existing PS1 handling), min-height in Task 11 step 5. ✓

**Placeholder scan:** Several places in Tasks 7 and 9 say "use whatever the existing code uses to fire pty:data" or "look for the existing pending-block concept" — these are intentional reads-the-codebase pointers because the relevant existing data structure varies by what's currently in the file. Not placeholders for unwritten logic; they're "consult the file" instructions paired with concrete code blocks. Acceptable.

**Type consistency:** `BlockBodyMode` defined in Task 9 step 1, used in Tasks 9–11. `EchoChangeEvent` shape defined in Task 6, used in Tasks 7–8. `ShellHook` defined in Task 1, used in Tasks 5–8. Consistent.

**Open implementation risk:** Task 7's reference to `(term as any)._fd` depends on node-pty's internal layout. If a future node-pty version changes this, the poller silently fails and we fall back to the regex path. Acceptable for v1; flag as TODO in Task 12 step 4 if it doesn't work on first try.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-01-card-shell-integration.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
