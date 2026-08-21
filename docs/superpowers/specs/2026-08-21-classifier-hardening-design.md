# Classifier Hardening — Design

**Date:** 2026-08-21
**Status:** Approved design, pending implementation plan
**Branch:** `master`

## Problem

`classifyInput` (`src/utils/commandDetector.ts:152`) decides whether what you
typed is a shell command or a question for the AI. It does so from a fixed
thirteen-rung cascade over two hardcoded vocabularies: `KNOWN_COMMANDS`, a
hand-written set of 184 binaries, and `NL_STARTERS`, a regex of imperative and
interrogative openers.

Two structural weaknesses follow from that, and neither is fixable by adding
more words to the sets.

**It cannot be taught.** When the classifier is wrong the user corrects it with
Shift-Tab (`src/components/TerminalInput.tsx:277`) and the correction dies with
that keystroke. The next identical input is misclassified identically. A user
whose habits sit on the wrong side of a rung — a personal script named
`explain`, or a routine of asking the AI to `find` things — fights the same
fight forever.

**It knows 184 commands out of 3957.** That is how many executables are on PATH
on this machine. Everything outside `KNOWN_COMMANDS` with no shell syntax
attached falls through to `sticky-fallback` and returns `shell` at
`CONFIDENCE.LOW` (0.55) — below `FLIP_THRESHOLD` (0.7), so the composer does not
auto-flip. `Rscript analyse.R` is a shell command the classifier declines to
commit to.

**And three of the 184 were English verbs.** `find`, `make` and `which` are in
`KNOWN_COMMANDS`, and `known-command` (rung 6) sits above `nl-starter` (rung 7),
so `find the bug in auth.ts` and `make it faster` classified as **shell** before
this work. This was a pre-existing bug, not one this work introduces, and it
was the single most likely correction a user of this classifier ever made.
Fixed by the new `ambiguous-command` rung, nested inside `known-command`: see
below.

## Constraints and prior decisions

Settled before this document:

| Question | Decision |
|---|---|
| What is a "correction"? | The pre-submit mode toggle only. Not post-submit regret, not re-running an input a different way. |
| What is learning keyed on? | The first token, lowercased. |
| Algorithm | Extend the existing layered cascade. No scoring model, no ML. |
| Command source | PATH membership only for v1. Shell aliases and functions are a follow-up. |

`classifyInput` must remain a pure function. It is called on every keystroke
(`TerminalInput.tsx:458`) and is covered by a large table-driven test suite that
depends on that purity.

## Design

### 1. Two new cascade rungs, placed asymmetrically

Two new `DecisionSource` values, `'learned'` and `'path-binary'`, so every
decision remains traceable to the rung that made it.

**`learned` is inserted at rung 5 — above `known-command` and `nl-starter`,
below the syntax rungs.**

A correction is a claim about a *word*, so it must outrank the other word-based
rungs; overriding `nl-starter` for `find` and `known-command` for a personal
`explain` script is the entire feature. It must not outrank *syntax*.
`git log | grep foo` is shell because of the pipe and `what is find?` is AI
because of the question mark, whatever has been taught about those tokens.
Those rungs assert facts about the string; `learned` asserts a preference about
a vocabulary item.

**`path-binary` is inserted at rung 11 — below all four natural-language rungs,
above `short-token`.**

PATH membership looks like a strong shell signal and is not. Seven PATH
binaries on this machine are also `NL_STARTERS`. Three of them — `find`, `make`,
`which` — are in `KNOWN_COMMANDS` and are handled by the new `ambiguous-command`
rung nested inside it (see Problem). The other four are classified
**correctly** today and would break:

```
compare  convert  who  write
```

Placed high, the rung would turn `convert this to typescript`, `write the tests`
and `who owns this service` into shell commands. The colliding words are
precisely the imperative verbs that open AI requests, and a 3957-name net catches
them all.

Placed low, it is not a shell signal at all — it is a **confidence upgrade for
inputs that every other rung declined**. `Rscript analyse.R` moves from
`sticky-fallback`/LOW to `path-binary`/MED (0.75), crossing `FLIP_THRESHOLD` and
auto-flipping the composer. The effect is confined to inputs nothing else had an
opinion about.

Resulting cascade (14 rungs; `ambiguous-command` is nested inside
`known-command` rather than a separate first-token check, since it only fires
for the three collision words):

| # | Source | Change |
|---|---|---|
| 1 | `empty` | |
| 2 | `agent-cli` | |
| 3 | `shell-syntax` | |
| 4 | `question-mark` | |
| 5 | **`learned`** | new |
| 6 | `known-command` | |
| 6a | **`ambiguous-command`** | new, nested in `known-command` |
| 7 | `nl-starter` | |
| 8 | `nl-pronoun` | |
| 9 | `nl-word-score` | |
| 10 | `shell-token-score` | |
| 11 | **`path-binary`** | new |
| 12 | `short-token` | |
| 13 | `sticky-fallback` | |

### 2. Both inputs arrive through `ClassifyContext`

```ts
export interface ClassifyContext {
  currentMode?: InputType;
  /** Thresholded verdicts, token -> type. Absent disables the `learned` rung. */
  learned?: ReadonlyMap<string, InputType>;
  /** Local PATH basenames. Absent disables the `path-binary` rung. */
  pathBinaries?: ReadonlySet<string>;
}
```

`learned` carries *resolved verdicts*, not raw counts: the threshold rules live
in `classifierMemory` and the classifier performs a lookup. Purity is preserved
and no storage access enters the hot path.

Both fields are optional, and with neither supplied the cascade behaves exactly
as it does today. The change is strictly additive.

### 3. The correction store — `src/utils/classifierMemory.ts`

New module, shaped like `src/utils/remoteIntegration.ts`: pure functions over a
narrowed storage interface, so tests supply a `Map` rather than mocking
`localStorage`. One key, `tai:cls:learn`, holding
`{ [token]: { ai: number, shell: number } }`.

**What is recorded.** A Shift-Tab records only when the classifier held a
contradicting opinion *and* the deciding rung is one that `learned` could
override. Corrections against `shell-syntax`, `agent-cli` or `question-mark` are
discarded: those rungs sit above `learned`, so the resulting entry could never
fire, and it would distort the token's counts for the cases where it could. A
first token that is not a plain word (`/^[a-z0-9_][\w.-]*$/i`) is likewise
skipped, so `./deploy` and `VAR=x` never create entries.

**Counting.** A correction increments its own direction and decrements the
other, floored at zero.

| Rule | Value | Reason |
|---|---|---|
| Net required to fire | 2 | Shift-Tab is adjacent to Tab; one stray press must teach nothing. |
| Per-direction cap | 10 | Two corrections reverse a settled habit instead of out-voting fifty stale ones. |
| Map size cap | 200 tokens | Evict lowest total on insert. |

**Deliberately excluded:** the force-shell prefix at `TerminalInput.tsx:439`
(`stripForceShellPrefix`) is also an explicit "no, shell", and arguably a
stronger signal than Shift-Tab. It is out of v1 on the theory that it is typed
as a habitual escape hatch rather than as a correction, and training on it would
learn from inputs the user never considered ambiguous. Revisit if that proves
wrong.

### 4. PATH scanning, and why remote hosts get nothing

PATH is scanned in the main process: one `readdir` per PATH entry with
`withFileTypes`, keeping every non-directory entry. Entries are not `stat`ed for
the executable bit — four thousand syscalls to slightly narrow the weakest rung
in the cascade is not a trade worth making, and a false positive there costs a
confidence upgrade at most. Unreadable directories are skipped rather than
thrown. The result is cached against the PATH string and re-scanned when it
changes.

**Remote suppression falls out of the optional field.** PATH is scanned on the
local machine, so during an ssh session those names describe the wrong computer.
The caller omits `pathBinaries` when `promptInfo.isRemote` is set
(`TerminalInput.tsx:479`) and the rung self-disables. No flag, no extra branch,
no new state.

Learned corrections remain global across hosts: they describe the user's
vocabulary, not the machine.

## Testing

**Cascade (`tests/unit/commandDetector.test.ts`)**

- `learned` overrides `known-command` and `nl-starter` in both directions.
- `learned` never beats `shell-syntax`, `agent-cli` or `question-mark`.
- `Rscript analyse.R` moves LOW → MED and therefore begins auto-flipping.
- The four path-only collision words still classify as AI in sentence form
  (`convert this to typescript`, `write the tests`, `who owns this service`,
  `compare these two files`).
- With neither context field supplied, every pre-existing test passes unchanged.

**Store (`tests/unit/classifierMemory.test.ts`)**

- Net-2 threshold; a single correction does not fire.
- Opposite-direction decrement, floored at zero.
- Per-direction cap and 200-token eviction.
- Skipped token shapes and skipped source rungs record nothing.
- A storage that throws does not propagate.

**Main process**

- PATH scan tolerates missing and unreadable directories and an empty PATH.

## Out of scope

- Shell aliases and functions as a command source (needs a shell-integration
  round trip; planned follow-up).
- Per-host learned corrections.
- Learning from post-submit signals such as a command's exit status.
- Any scoring or ML model replacing the cascade.
