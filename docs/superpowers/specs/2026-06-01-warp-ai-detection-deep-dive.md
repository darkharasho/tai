# Warp AI & Detection — Deep Dive and TAI Improvement Plan

**Date:** 2026-06-01
**Status:** Analysis / research — no code changes yet
**Sources:** [warpdotdev/warp](https://github.com/warpdotdev/warp) (open-sourced Apr 28 2026, AGPLv3 + MIT for UI crates); Warp docs on [terminal & agent modes](https://docs.warp.dev/agent-platform/local-agents/interacting-with-agents/terminal-and-agent-modes/).

This document compares how Warp handles AI integration and input/program "detection" against TAI's current implementation, then proposes prioritized improvements. It is the grounding artifact for follow-up specs in three areas: **AI context enrichment**, **input autodetect UX**, and **detection accuracy**.

---

## 1. How Warp does it

### 1.1 Block-based substrate
Every command + its output is one discrete block (exit code, duration, timestamp, selectable/copyable). Everything else — AI context, structured agent rendering, autodetect UI — is built on this unit.

### 1.2 Input classification (`crates/input_classifier`)
Warp's biggest detection asset is a dedicated crate that decides, **per keystroke**, whether the input line is a **shell command** or a **natural-language AI query**.

**Pipeline** (`heuristic_classifier/mod.rs::detect_input_type`):
1. **One-off NL allowlist** — single token matching `{"hello","hi","hey","hola","thanks","explain","yes","no","what","nice","1. "}` (or a *prefix* of one) → AI. Prefix matching avoids mode-flipping during progressive typing.
2. **`is_likely_shell_command`** heuristic (`util.rs`) → Shell.
3. **Fallback** → the ONNX model (`OnnxClassifier`, a BERT-tiny model selected by `nld_classifier_v1/v2` cargo features), with the heuristic as panic-fallback.

**Probabilistic output** (`lib.rs`): classification returns `ClassificationResult { p_shell, p_ai, source }` with a `confidence()` = `max(p_shell, p_ai)`. The UI can therefore gate on confidence and stay quiet when unsure. The `source` is one of an `InputClassifierDecisionSource` enum (`InputClassifier`, `InputClassifierFallbackHeuristic`, `NaturalLanguageOneOffAllowlist`, `ShellCommandAllowList`, `ShellHeuristic`, …) — useful for telemetry and debugging.

**Context-aware stickiness** (`Context { current_input_type, is_agent_follow_up }`):
- Asymmetric token thresholds: `MINIMUM_COMMAND_DETECTION_TOKEN_LENGTH` vs `MINIMUM_NATURAL_LANGUAGE_DETECTION_TOKEN_LENGTH` — switching *out of* the current mode requires meeting a minimum token count, so a half-typed line doesn't thrash.
- `AGENT_FOLLOW_UP_INPUTS = {"yes","continue","do it","approve"}` → forced AI when the input follows an agent response.

**Incomplete-last-token handling** (`natural_language_detection_heuristic`): runs the NL heuristic twice — once excluding the last (possibly unfinished) token, once including it. If *either* says AI, the result is AI. The last token is treated complete when the buffer ends in `[' ','?','!','.','"',',']`.

**Token-count-scaled thresholds:**
- Shell side (`is_likely_shell_command`): `1.0` for ≤2 tokens, `0.7` for ≤4, `0.5` otherwise.
- NL side: `1.0` for ≤3 tokens, `0.8` for ≤4, `0.6` otherwise.
- Short inputs demand unanimity; longer inputs tolerate a mix.

**PATH-aware command detection:** a token counts as "command-like" when `token.token_description.is_some()` — i.e. Warp's completion engine recognizes the binary (installed on the system / known spec). `is_installed_binary` checks the first token this way. This is dynamic, unlike a static keyword list.

**The CLI-agent guardrail (load-bearing for TAI):** `ONE_OFF_SHELL_COMMAND_KEYWORDS = {"#","echo","man","sudo","claude","codex","gemini"}`. The source comment is explicit:

> `claude`, `codex`, and `gemini` are not actually _really_ one-off shell command keywords, but false-positive NL classifications for these inputs … suck, because the user often thinks we're intentionally trying to push them away from those CLIs into Agent Mode, so we mitigate the risk by always treating as shell.

### 1.3 Autodetect UX
- Inline magenta **"(autodetected)"** label shows the classification before submit.
- In agent view, a detected command gets a **distinct border** around the input.
- Override: **⌘I / Ctrl+I** toggles modes; selection becomes **sticky** after manual override. In agent view, **`!` prefix** forces shell (e.g. `!ls`).

### 1.4 CLI-agent rich input (`specs/Advait-M/cli-agent-rich-input-shell-commands/TECH.md`)
When a CLI agent (Claude Code / Codex / OpenCode) is running, Warp opens a "rich input" composer locked to AI mode (suppressing shell decorations). Typing **`!`** drops to a *shell sub-mode*: strips the `!`, switches to Shell-locked, re-enables syntax highlighting + error underlining + completions, renders a blue `!` indicator, and shows placeholder "Run commands". On submit it re-prepends `!`, sends to the agent's PTY, and reverts to AI mode. A singleton `CLIAgentSessionsModel` tracks which agent is open per terminal view.

### 1.5 "Active AI" context
Warp's AI watches ambient shell state — cwd, recent commands, exit codes, git branch, recent block input/output — to drive prompt suggestions, next-command recommendations, and diffs. (The marketing/docs pages don't enumerate the exact fields; the block model above is what makes them available.)

---

## 2. How TAI does it today

| Concern | Warp | TAI | File |
|---|---|---|---|
| Block segmentation | Native blocks | OSC 133 markers + custom OSC 6973 hooks, regex prompt-heuristic fallback | `src/components/BlockSegmenter.ts` |
| Input classification | Probabilistic ML + heuristic, context-aware | Single boolean heuristic, stateless | `src/utils/commandDetector.ts:70` (`looksLikeShellCommand`) |
| Known-command set | PATH/completion-engine dynamic | Static `KNOWN_COMMANDS` set (~150 entries) | `commandDetector.ts:3` |
| NL detection | Dictionary score + ONNX | Static word sets (`NL_STARTERS`, `NL_WORDS`, `SENTENCE_WORDS`, `PRONOUNS`) | `commandDetector.ts:31-68` |
| Autodetect UX | "(autodetected)" label, ⌘I, `!`, sticky | **None** — classification is invisible, no override affordance | `src/components/TerminalInput.tsx` |
| Running-agent detection | `CLIAgentSessionsModel` + `!` escape | termios `!icanon` → xterm raw mode; alt-screen + `TUI_REPOSITION_RE` cursor heuristics | `electron/services/termiosPoller.ts`, `BlockSegmenter.ts:25,656` |
| AI itself | Built-in agent **or** wrapped CLIs | Wrapped external CLIs (claude/codex/gemini) | `src/providers/*.ts` |
| AI context sent | Rich ambient shell state | **`cwd` + `trustLevel` only** | `src/providers/claude.ts:10`, `types.ts:19` |

**TAI's strengths Warp lacks an exact analog for:** robust OSC 133 / OSC 6973 shell-integration segmentation with a legacy regex fallback, termios-based password-prompt and raw-mode detection, and `TUI_REPOSITION_RE` for Ink-style TUIs that redraw on the main buffer. TAI's *program* detection (interactive/REPL/TUI) is arguably more rigorous than what's visible in Warp's open source.

**The two clearest gaps:**
1. **AI context** — TAI captures exit codes, durations, cwd, command history, git-relevant output in `BlockSegmenter`, but threads almost none of it to the agent. Warp's entire edge is ambient context.
2. **Autodetect is a black box** — `looksLikeShellCommand` makes the same agent-vs-shell call Warp surfaces, but the user never sees it and can't correct it.

---

## 3. Prioritized recommendations

### P0 — AI context enrichment (highest impact, lowest risk)
Thread the data TAI *already has* into the agent prompt. Build a context block from recent `SegmentedBlock`s: last N commands with exit codes + durations, current cwd, git branch (from cwd or an OSC 6973 field), and the most recent block's output (truncated). Pass it alongside the user message in `providers/*.ts::send`.
- **Why first:** real capability gain, no UX redesign, no classifier risk. Data is in hand.
- **Open question:** per-provider injection (system-prompt preamble vs first user turn) and truncation budget.

### P1 — Adopt Warp's classifier improvements in `commandDetector.ts`
Port the high-value, ML-free ideas:
1. **Always-shell guardrail** for `claude`/`codex`/`gemini` (+ `sudo`,`man`,`echo`,`#`). Directly prevents TAI from hijacking launches of the very CLIs it wraps. *(Trivial, do immediately.)*
2. **Probabilistic return** — replace the boolean with `{ type, confidence, source }` so the UI can gate on confidence. Keep `looksLikeShellCommand` as a thin wrapper for callers that still want a bool.
3. **Stickiness / context** — pass `currentInputType` (and optionally an agent-follow-up allowlist `{"yes","continue","do it","approve"}`); use asymmetric thresholds so a half-typed line doesn't thrash.
4. **Incomplete-last-token** — classify with and without the trailing token; AI wins ties. Treat token complete when the buffer ends in `[' ','?','!','.','"',',']`.
5. **Token-count-scaled thresholds** instead of the current ad-hoc `words.length <= 3` checks.
6. **PATH-aware known commands** (optional) — replace/augment the static `KNOWN_COMMANDS` with a cached lookup of binaries on `$PATH` (main process can shell out once and cache).

### P2 — Autodetect UX in `TerminalInput.tsx`
Surface the P1 classifier: an inline badge ("→ shell" / "→ ai") with a confidence gate, a toggle key (e.g. Ctrl+I), and a `!` prefix to force shell. Make manual overrides sticky for the current line.

### P3 — Running-agent `!` escape — DROPPED (2026-06-01)
Originally: when TAI routed input to a wrapped CLI agent through xterm (termios raw mode), allow a `!cmd` escape to run a one-off shell command, mirroring Warp's CLI-agent rich input.

**Decision: dropped after an architecture review.** It doesn't translate to TAI's model:
- **The agent already owns `!`.** When `claude`/`codex` runs as an interactive REPL in the PTY, every keystroke (including `!`) routes straight through `HiddenXterm → pty.write` to the program, and Claude Code has its *own* `!` bash mode. Intercepting `!` in TAI would break the agent's native handling. (Warp's own spec does the same — it passes `!cmd` through to the agent's PTY; the agent interprets it.) Nothing to build.
- **The composer case is already done in P2.** When the agent runs as TAI's *provider* (a structured child process, not the PTY), the user types in `TerminalInput` AI mode, where P2 already added the `!` force-shell.
- **The only novel slice** — running a one-off shell command while a *generic* REPL (python, psql) holds the single per-tab PTY — is OS-constrained: it requires spawning a second scratch PTY, which is high-effort with marginal payoff (you can suspend/exit the REPL). Not pursued.

Net: P3 is redundant with P2 + the agents' own `!` handling, or OS-constrained. The roadmap closes at P0–P2.

### Not recommended (now)
- **Embedding a BERT-tiny ONNX model.** Warp's heuristic layer already resolves most cases; the model is a refinement. The heuristic ports (P1) capture most of the benefit without the ONNX runtime, model bytes, and inference latency in an Electron renderer. Revisit only if heuristic accuracy plateaus.

---

## 4. Suggested sequencing
Each becomes its own spec → plan → implementation cycle:
1. **P0 AI context enrichment** — standalone, immediate value.
2. **P1 classifier rework** — start with the `claude/codex/gemini` guardrail (one-line risk reduction), then the probabilistic/context refactor.
3. **P2 autodetect UX** — consumes P1's probabilistic output.
4. ~~**P3 `!` escape**~~ — dropped (see P3 section above); roadmap closes at P0–P2.

## Appendix — Warp source references
- `crates/input_classifier/src/lib.rs` — `InputClassifier` trait, `ClassificationResult`, `InputClassifierDecisionSource`, `Context`.
- `crates/input_classifier/src/heuristic_classifier/mod.rs` — pipeline, thresholds, incomplete-last-token logic.
- `crates/input_classifier/src/util.rs` — `is_likely_shell_command`, `is_installed_binary`, allowlists, the claude/codex/gemini guardrail comment.
- `crates/input_classifier/Cargo.toml` — `nld_classifier_v1/v2`, `nld_heuristic_v1/v2` feature flags.
- `app/src/ai/blocklist/input_model.rs` — AI-input locking vs autodetection.
- `specs/Advait-M/cli-agent-rich-input-shell-commands/TECH.md` — CLI-agent `!` shell sub-mode.
