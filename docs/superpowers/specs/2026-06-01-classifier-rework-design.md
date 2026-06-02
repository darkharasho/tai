# P1 — Input Classifier Rework (Design)

**Date:** 2026-06-01
**Status:** Design — awaiting review
**Parent:** [Warp AI & Detection Deep Dive](./2026-06-01-warp-ai-detection-deep-dive.md) (recommendation P1)
**Decisions baked in:** build the probabilistic API now (enables P2); **defer** PATH-aware command detection; add **asymmetric/sticky** context but **defer** the agent-follow-up allowlist.

## Goal

Replace TAI's boolean `looksLikeShellCommand` with a probabilistic, context-aware classifier that returns a type, a confidence, and a decision source — porting Warp's accuracy techniques (token-count-scaled thresholds, natural-language word scoring, incomplete-last-token handling) — and use confidence to stop the live mode-flipping in `TerminalInput` from thrashing on ambiguous half-typed input.

## Current state

- `src/utils/commandDetector.ts` exports `looksLikeShellCommand(input): boolean` — an ordered set of regex/keyword heuristics. The `claude/codex/gemini` always-shell guardrail already landed (`WRAPPED_AGENT_CLIS`).
- `src/components/TerminalInput.tsx:240-256` calls it on every keystroke (`handleChange`) and flips the mode: shell→ai when the text stops looking like a command, ai→shell when it starts. `manualOverrideRef` already disables autodetect after a manual toggle (Warp's "sticky after override"), resetting on submit/empty.
- The flaw: the boolean flips even on weak/ambiguous guesses, so a half-typed token can bounce the mode back and forth mid-word.

## Architecture

### New classifier API (`src/utils/commandDetector.ts`)

```ts
export type InputType = 'shell' | 'ai';

export interface ClassifyContext {
  /** Current input mode, for asymmetric stickiness. */
  currentMode?: InputType;
}

export type DecisionSource =
  | 'empty' | 'agent-cli' | 'shell-syntax' | 'known-command'
  | 'nl-starter' | 'nl-pronoun' | 'question-mark'
  | 'nl-word-score' | 'shell-token-score' | 'short-token' | 'sticky-fallback';

export interface ClassificationResult {
  type: InputType;
  /** 0..1 — synthesized signal strength (rule-based, not ML). */
  confidence: number;
  source: DecisionSource;
}

export function classifyInput(input: string, ctx?: ClassifyContext): ClassificationResult;
```

`looksLikeShellCommand` is reimplemented as a thin wrapper preserving exact current behavior:

```ts
export function looksLikeShellCommand(input: string): boolean {
  if (!input.trim()) return false;          // preserve current empty → false
  return classifyInput(input).type === 'shell';
}
```

All existing `commandDetector.test.ts` cases must keep passing through this wrapper.

### Confidence tiers

| Tier | Value | Meaning | Sources |
|---|---|---|---|
| HIGH | `0.95` | Explicit, unambiguous signal | `agent-cli`, `shell-syntax` (pipe/redirect/`;`/`&`/path/env/flag), `known-command`, `nl-starter`, `question-mark`, `nl-pronoun` |
| MED | `0.75` | Score-based decision that clears its threshold comfortably | `nl-word-score`, `shell-token-score` |
| LOW | `0.55` | Weak guess / fallback | `short-token`, `sticky-fallback` |

Exported as named constants (`CONFIDENCE.HIGH/MED/LOW`).

### Decision pipeline (order matters — first match wins)

1. **Empty** → `{ ai, 0, 'empty' }` (wrapper maps to `false`).
2. **Agent CLI** first token in `WRAPPED_AGENT_CLIS` → `{ shell, HIGH, 'agent-cli' }` (existing guardrail, now ahead of the `?` check as today).
3. **Explicit shell syntax** — leading `./ ~ /`, `VAR=`, operators `| > < ; &`, or a `-flag` token → `{ shell, HIGH, 'shell-syntax' }`.
4. **Question mark** present → `{ ai, HIGH, 'question-mark' }`.
5. **Known command** as first token (`KNOWN_COMMANDS`) → `{ shell, HIGH, 'known-command' }`.
6. **NL starter** regex (`what|how|why|...`) at start → `{ ai, HIGH, 'nl-starter' }`.
7. **Pronoun** present among tokens (`PRONOUNS`) → `{ ai, HIGH, 'nl-pronoun' }`.
8. **Scoring** (token-count-scaled, mirrors Warp's `util.rs`):
   - `nlScore` = fraction of tokens in `NL_WORDS ∪ SENTENCE_WORDS`; `shellScore` = fraction of tokens that are known commands or contain shell syntax.
   - Threshold scales with token count: `≤3 → 1.0`, `≤4 → 0.8`, else `0.6`.
   - **Incomplete-last-token:** if the buffer does not end in a boundary char `[' ' '?' '!' '.' '"' ',']` and there are `>2` tokens, also compute `nlScore` without the last token; if *either* pass clears the NL threshold → `{ ai, MED, 'nl-word-score' }`. (Mirrors Warp classifying with and without the trailing token; AI wins.)
   - Else if `shellScore` clears its threshold → `{ shell, MED, 'shell-token-score' }`.
9. **Short token fallback:** single token matching `^[a-z0-9_][\w.-]*$` → `{ shell, LOW, 'short-token' }` (an unknown bare word is probably a command).
10. **Sticky fallback:** nothing decisive → return `{ type: ctx?.currentMode ?? 'shell', LOW, 'sticky-fallback' }`. (Asymmetric stickiness: ambiguous input stays in the current mode instead of guessing.)

### Asymmetric stickiness

Two reinforcing layers:
- **In `classifyInput`:** the `sticky-fallback` step returns the current mode (never flips on no evidence). When `ctx.currentMode` is set, a single ambiguous token also resolves to `currentMode` at LOW rather than guessing shell.
- **In the consumer (`TerminalInput`):** only auto-flip when `confidence >= FLIP_THRESHOLD` (`0.7`). LOW results (`0.55`) never flip the mode; MED/HIGH do. This is what kills the mid-word thrash.

### Consumer change (`src/components/TerminalInput.tsx`)

Replace the boolean checks in `handleChange` (lines 250-253) with:

```ts
} else {
  const { type, confidence } = classifyInput(trimmed, { currentMode: mode });
  if (confidence >= FLIP_THRESHOLD && type !== mode) {
    onModeChange(type);
  }
}
```

`FLIP_THRESHOLD` is `0.7`, defined in `commandDetector.ts` and imported. Empty-input handling (force shell) and `manualOverrideRef` gating are unchanged. The visible "(autodetected)" badge is **P2**, not this task.

## Data flow

```
keystroke → TerminalInput.handleChange
   → classifyInput(trimmed, { currentMode: mode })   // pure, src/utils/commandDetector.ts
   → { type, confidence, source }
   → flip mode only if confidence ≥ 0.7 and type changed
```

## Testing (TDD)

`tests/unit/commandDetector.test.ts` (extend; keep all existing cases green):
- Every existing `looksLikeShellCommand` assertion still passes via the wrapper.
- `classifyInput` returns the right `source` for each pipeline branch (agent-cli, shell-syntax, question-mark, known-command, nl-starter, nl-pronoun).
- Confidence tiers: explicit signals → `HIGH`; scoring wins → `MED`; bare unknown token / ambiguous → `LOW`.
- **Incomplete-last-token:** `"how are yo"` (mid-word, no trailing space) still classifies AI; a trailing-space variant also AI.
- **Token-scaled thresholds:** a 2-token mixed input requires unanimity; a 6-token mostly-NL input classifies AI at `0.6`.
- **Stickiness:** an ambiguous single unknown token with `currentMode:'ai'` returns `type:'ai'` (`sticky-fallback`), and with `currentMode:'shell'` returns `'shell'`.
- `looksLikeShellCommand('') === false`; `classifyInput('').source === 'empty'`.

(`TerminalInput` flip-gating is verified by `npm run build` + manual check — it's React wiring; the logic it depends on is unit-tested in `classifyInput`.)

## Out of scope

- **PATH-aware command detection** (live `$PATH` lookup via IPC) — deferred; the static `KNOWN_COMMANDS` + scoring is the P1 baseline.
- **Agent-follow-up allowlist** (`"yes"/"continue"/"do it"/"approve"` → AI) — deferred; low value for TAI's per-input model.
- **The visible "(autodetected)" badge and `!`/toggle override UI** — that is P2.
- An ONNX/ML classifier — explicitly not pursued (see deep-dive).

## Risks & mitigations

- **Behavior drift** — existing boolean outcomes are pinned by the retained `commandDetector.test.ts` suite through the wrapper; any drift fails a test.
- **Confidence values are synthesized, not probabilities** — documented; tiers are coarse on purpose. They exist to gate flipping and (later) badge display, not to express true likelihood.
- **Threshold tuning** — `FLIP_THRESHOLD`/tier constants are centralized and easy to adjust; defaults chosen so only LOW stays put.
