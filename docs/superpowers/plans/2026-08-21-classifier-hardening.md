# Classifier Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Teach TAI's shell-vs-AI input classifier from the user's Shift-Tab corrections, let it recognise every binary on PATH rather than a hardcoded 184, and stop the three known commands that are also English verbs from swallowing sentences.

**Architecture:** One pre-existing bug is fixed first — `find`, `make` and `which` are in `KNOWN_COMMANDS`, which outranks `nl-starter`, so they currently capture any sentence starting with them. Then two new rungs are inserted into the existing thirteen-rung cascade in `src/utils/commandDetector.ts` at deliberately asymmetric heights — `learned` above the vocabulary rungs but below the syntax rungs, `path-binary` near the bottom as a confidence upgrade only. Both arrive through `ClassifyContext` as optional pre-resolved data, so `classifyInput` stays a pure function and behaves exactly as today when neither is supplied. Correction counting lives in a new `src/utils/classifierMemory.ts` (pure functions over an injected storage interface, mirroring `src/utils/remoteIntegration.ts`); the PATH scan lives in a new main-process service mirroring `electron/services/git.ts`.

**Tech Stack:** TypeScript, React 18, Electron (main + preload + renderer over `ipcMain.handle`/`ipcRenderer.invoke`), Vitest.

**Spec:** `docs/superpowers/specs/2026-08-21-classifier-hardening-design.md`

## Global Constraints

- Tests run with `npm test` (`vitest run --config tests/vitest.config.ts`). **Never invoke `vitest` or `npx vitest` directly** — `tests/vitest.config.ts` sets the module aliases (`@/` → `src/`) and the worker limits (`pool: 'forks'`, `maxForks: 2`, `maxWorkers: 2`). Running without it produces dozens of spurious failures and can exhaust system memory.
- Typecheck with `npx tsc --noEmit`. There is **no `lint` script** in this project; do not try to run one.
- `classifyInput` must remain a pure function. It is called on every keystroke and has no access to `localStorage`, IPC, or `process`.
- With neither new `ClassifyContext` field supplied, every pre-existing test in `tests/unit/commandDetector.test.ts` must pass unchanged. The change is strictly additive.
- The whole suite must be green at the end of every task: **133 test files, 1012 tests** at the time this plan was written.
- Commit at the end of each task. End every commit message with:
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/utils/classifierMemory.ts` | create | Correction counting, thresholds, caps, storage I/O. Knows nothing about the cascade. |
| `tests/unit/classifierMemory.test.ts` | create | Store behaviour against a fake `Map`-backed storage. |
| `src/utils/commandDetector.ts` | modify | `AMBIGUOUS_COMMANDS` (Task 2), then two new rungs, three new `DecisionSource` values, two new `ClassifyContext` fields. |
| `tests/unit/commandDetector.test.ts` | modify | Ambiguous verbs, rung placement, both learning directions, collision-word regressions. |
| `electron/services/pathBinaries.ts` | create | Pure PATH scan + `setupPathBinariesService()` IPC registration. |
| `tests/unit/pathBinaries.test.ts` | create | Scan against an injected fake `readdir`. |
| `electron/main.ts` | modify | Call `setupPathBinariesService()`. |
| `electron/preload.ts` | modify | Expose `shell.pathBinaries()`. |
| `src/types/window.d.ts` | modify | Type it. |
| `src/components/TerminalInput.tsx` | modify | Load both context inputs, pass them to `classifyInput`, record corrections on Shift-Tab, suppress PATH on remote. |

Task 1 and Task 4 are independent. Tasks 2 and 3 both edit the cascade in `src/utils/commandDetector.ts` and must land in that order. Task 5 consumes all of them.

---

### Task 1: The correction store

**Files:**
- Create: `src/utils/classifierMemory.ts`
- Test: `tests/unit/classifierMemory.test.ts`

**Interfaces:**
- Consumes: `InputType` and `DecisionSource` types from `src/utils/commandDetector.ts` (both already exported today — no change needed there for this task).
- Produces:
  - `loadLearnedVerdicts(store: LearnStore): ReadonlyMap<string, InputType>`
  - `recordCorrection(input: string, corrected: InputType, source: DecisionSource, store: LearnStore): void`
  - `interface LearnStore { getItem(key: string): string | null; setItem(key: string, value: string): void }`
  - Constants `LEARN_KEY`, `LEARN_THRESHOLD`, `COUNT_CAP`, `MAX_TOKENS`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/classifierMemory.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  loadLearnedVerdicts,
  recordCorrection,
  LEARN_KEY,
  COUNT_CAP,
  MAX_TOKENS,
} from '@/utils/classifierMemory';

/** Minimal localStorage stand-in. */
const store = () => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    raw: () => JSON.parse(m.get(LEARN_KEY) ?? '{}'),
  };
};

describe('loadLearnedVerdicts', () => {
  it('is empty for a store that has never been written', () => {
    expect(loadLearnedVerdicts(store()).size).toBe(0);
  });

  it('survives corrupt JSON rather than throwing', () => {
    const s = store();
    s.setItem(LEARN_KEY, '{not json');
    expect(loadLearnedVerdicts(s).size).toBe(0);
  });

  it('survives a storage that throws (private mode, quota)', () => {
    const dead = {
      getItem: () => { throw new Error('nope'); },
      setItem: () => { throw new Error('nope'); },
    };
    expect(loadLearnedVerdicts(dead).size).toBe(0);
    expect(() => recordCorrection('find x', 'ai', 'nl-starter', dead)).not.toThrow();
  });
});

describe('recordCorrection — the net-2 threshold', () => {
  // Shift-Tab sits right next to Tab. One stray press must teach nothing.
  it('does not fire on a single correction', () => {
    const s = store();
    recordCorrection('find the bug', 'ai', 'nl-starter', s);
    expect(loadLearnedVerdicts(s).size).toBe(0);
  });

  it('fires on the second correction in the same direction', () => {
    const s = store();
    recordCorrection('find the bug', 'ai', 'nl-starter', s);
    recordCorrection('find the leak', 'ai', 'nl-starter', s);
    expect(loadLearnedVerdicts(s).get('find')).toBe('ai');
  });

  it('learns in the shell direction too', () => {
    const s = store();
    recordCorrection('explain foo', 'shell', 'nl-starter', s);
    recordCorrection('explain bar', 'shell', 'nl-starter', s);
    expect(loadLearnedVerdicts(s).get('explain')).toBe('shell');
  });

  it('keys on the first token, lowercased, ignoring the rest of the input', () => {
    const s = store();
    recordCorrection('Find the bug', 'ai', 'nl-starter', s);
    recordCorrection('FIND anything else', 'ai', 'nl-starter', s);
    expect(loadLearnedVerdicts(s).get('find')).toBe('ai');
  });
});

describe('recordCorrection — reversal', () => {
  it('decrements the opposite direction, so two corrections turn a habit around', () => {
    const s = store();
    recordCorrection('find a', 'ai', 'nl-starter', s);
    recordCorrection('find b', 'ai', 'nl-starter', s);
    expect(loadLearnedVerdicts(s).get('find')).toBe('ai');

    recordCorrection('find c', 'shell', 'learned', s);   // net 1
    expect(loadLearnedVerdicts(s).has('find')).toBe(false);
    recordCorrection('find d', 'shell', 'learned', s);   // net 0
    recordCorrection('find e', 'shell', 'learned', s);   // net -1
    recordCorrection('find f', 'shell', 'learned', s);   // net -2
    expect(loadLearnedVerdicts(s).get('find')).toBe('shell');
  });

  it('floors a direction at zero rather than going negative', () => {
    const s = store();
    recordCorrection('find a', 'shell', 'nl-starter', s);
    expect(s.raw().find).toEqual({ ai: 0, shell: 1 });
  });
});

describe('recordCorrection — caps', () => {
  it('caps a direction so stale votes cannot be insurmountable', () => {
    const s = store();
    for (let i = 0; i < COUNT_CAP + 20; i++) recordCorrection('find x', 'ai', 'nl-starter', s);
    expect(s.raw().find.ai).toBe(COUNT_CAP);
  });

  it('evicts the lowest-total token once the map is full', () => {
    const s = store();
    // 'weak' gets one vote; everything else gets two.
    recordCorrection('weak x', 'ai', 'nl-starter', s);
    for (let i = 0; i < MAX_TOKENS; i++) {
      recordCorrection(`tok${i} x`, 'ai', 'nl-starter', s);
      recordCorrection(`tok${i} y`, 'ai', 'nl-starter', s);
    }
    const raw = s.raw();
    expect(Object.keys(raw).length).toBeLessThanOrEqual(MAX_TOKENS);
    expect(raw.weak).toBeUndefined();
  });
});

describe('recordCorrection — what is not worth learning', () => {
  // These rungs sit ABOVE `learned` in the cascade, so an entry created from
  // them could never fire, and it would distort the token's counts for the
  // cases where it could.
  it.each(['shell-syntax', 'agent-cli', 'question-mark', 'empty'] as const)(
    'records nothing when the deciding rung was %s',
    (source) => {
      const s = store();
      recordCorrection('find x', 'ai', source, s);
      recordCorrection('find y', 'ai', source, s);
      expect(loadLearnedVerdicts(s).size).toBe(0);
    },
  );

  it.each(['./deploy now', 'VAR=1 npm start', '  ', '~/bin/tool go'])(
    'records nothing for a first token that is not a plain word: %s',
    (input) => {
      const s = store();
      recordCorrection(input, 'shell', 'nl-starter', s);
      recordCorrection(input, 'shell', 'nl-starter', s);
      expect(loadLearnedVerdicts(s).size).toBe(0);
    },
  );
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npm test -- tests/unit/classifierMemory.test.ts`
Expected: FAIL — `Failed to resolve import "@/utils/classifierMemory"`.

- [ ] **Step 3: Write the implementation**

Create `src/utils/classifierMemory.ts`:

```ts
import type { InputType, DecisionSource } from './commandDetector';

/**
 * What the classifier has been taught by the user's pre-submit corrections.
 *
 * Keyed on the first token, because that is the token every vocabulary rung in
 * the cascade actually reads. Everything here is counting and thresholding; the
 * cascade itself receives only resolved verdicts, so `classifyInput` stays pure
 * and never touches storage on a keystroke.
 */

/** The slice of localStorage this module uses. Narrowed so tests can fake it. */
export interface LearnStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const LEARN_KEY = 'tai:cls:learn';

/** Net votes in one direction before a verdict fires. */
export const LEARN_THRESHOLD = 2;
/** Per-direction ceiling, so two corrections can reverse a settled habit. */
export const COUNT_CAP = 10;
/** Tokens retained; the lowest-total entry is evicted past this. */
export const MAX_TOKENS = 200;

interface Counts { ai: number; shell: number }
type LearnMap = Record<string, Counts>;

/** Only plain words are learnable — `./deploy` and `VAR=x` are decided by syntax. */
const LEARNABLE_TOKEN = /^[a-z0-9_][\w.-]*$/i;

/**
 * Rungs that sit ABOVE `learned` in the cascade. A correction against one of
 * these can never be acted on, so recording it would be dead weight that also
 * skews the token's counts for the inputs where `learned` does get a say.
 */
const UNLEARNABLE_SOURCES: ReadonlySet<DecisionSource> = new Set<DecisionSource>([
  'empty', 'agent-cli', 'shell-syntax', 'question-mark',
]);

function read(store: LearnStore): LearnMap {
  try {
    const raw = store.getItem(LEARN_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed as LearnMap : {};
  } catch {
    // Corrupt JSON, or storage unavailable. An empty memory is always safe:
    // the cascade simply falls through to the rungs below.
    return {};
  }
}

function write(store: LearnStore, map: LearnMap): void {
  try {
    store.setItem(LEARN_KEY, JSON.stringify(map));
  } catch {
    // The memory is an optimisation, not state anything depends on.
  }
}

function firstToken(input: string): string | null {
  const token = input.trim().split(/\s+/)[0]?.toLowerCase();
  if (!token || !LEARNABLE_TOKEN.test(token)) return null;
  return token;
}

/** Resolved verdicts for the `learned` rung — tokens below threshold are absent. */
export function loadLearnedVerdicts(store: LearnStore): ReadonlyMap<string, InputType> {
  const out = new Map<string, InputType>();
  const map = read(store);
  for (const [token, c] of Object.entries(map)) {
    if (!c || typeof c.ai !== 'number' || typeof c.shell !== 'number') continue;
    const net = c.ai - c.shell;
    if (net >= LEARN_THRESHOLD) out.set(token, 'ai');
    else if (-net >= LEARN_THRESHOLD) out.set(token, 'shell');
  }
  return out;
}

/**
 * Record one pre-submit correction.
 *
 * `source` is the rung that made the decision being corrected — see
 * UNLEARNABLE_SOURCES for why it matters. Incrementing one direction while
 * decrementing the other is what makes reversal cheap: a habit that changes
 * needs two corrections, not eleven.
 */
export function recordCorrection(
  input: string,
  corrected: InputType,
  source: DecisionSource,
  store: LearnStore,
): void {
  if (UNLEARNABLE_SOURCES.has(source)) return;
  const token = firstToken(input);
  if (!token) return;

  const map = read(store);
  const counts: Counts = map[token] ?? { ai: 0, shell: 0 };
  const other: keyof Counts = corrected === 'ai' ? 'shell' : 'ai';
  counts[corrected] = Math.min(COUNT_CAP, counts[corrected] + 1);
  counts[other] = Math.max(0, counts[other] - 1);
  map[token] = counts;

  const tokens = Object.keys(map);
  if (tokens.length > MAX_TOKENS) {
    const total = (t: string) => map[t].ai + map[t].shell;
    tokens
      .filter(t => t !== token)
      .sort((a, b) => total(a) - total(b))
      .slice(0, tokens.length - MAX_TOKENS)
      .forEach(t => { delete map[t]; });
  }

  write(store, map);
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npm test -- tests/unit/classifierMemory.test.ts`
Expected: PASS, all tests.

Then `npx tsc --noEmit` — expected: no output.

- [ ] **Step 5: Commit**

```bash
git add src/utils/classifierMemory.ts tests/unit/classifierMemory.test.ts
git commit -m "feat(classifier): remember the user's pre-submit corrections

Counts corrections per first token, in both directions. Firing needs a net of
two, so a stray Shift-Tab teaches nothing; counts cap at ten, so two
corrections can reverse a habit rather than having to out-vote fifty stale
votes. Corrections against the syntax rungs are discarded — they sit above the
learned rung, so such an entry could never fire.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Stop `find`, `make` and `which` swallowing English

**Files:**
- Modify: `src/utils/commandDetector.ts` — a new `AMBIGUOUS_COMMANDS` set and the `known-command` rung inside `classifyInput`
- Test: `tests/unit/commandDetector.test.ts` (append)

**Background.** This is a pre-existing bug, independent of the two new rungs.
`KNOWN_COMMANDS` contains 184 binaries, three of which are ordinary English
verbs: `find`, `make`, `which`. The `known-command` rung sits *above*
`nl-starter`, so today:

```
find the bug in auth.ts   =>  shell  known-command  0.95
make it faster            =>  shell  known-command  0.95
which approach is better  =>  shell  known-command  0.95
```

Demoting the three below `nl-starter` is **not** the fix — it would break
`make build`, `find src` and `which node`, whose first token is the same word.
The discriminator is the *rest* of the input: a later natural-language word or
pronoun means it is a sentence. Flag-bearing forms like `find . -name x` and
`make -j8` never reach this rung at all; they are caught by `shell-syntax`
several rungs earlier.

**Interfaces:**
- Consumes: nothing.
- Produces: `DecisionSource` gains `'ambiguous-command'`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/commandDetector.test.ts`:

```ts
describe('ambiguous commands that are also English verbs', () => {
  it.each([
    'find the bug in auth.ts',
    'find my keys',
    'make it faster',
    'make a backup of this',
    'which approach is better',
    'which of these is faster',
  ])('reads as AI when the rest of the input is a sentence: %s', (input) => {
    const r = classifyInput(input);
    expect(r.type).toBe('ai');
    expect(r.source).toBe('ambiguous-command');
    expect(r.confidence).toBe(CONFIDENCE.MED);
  });

  // The reason these three cannot simply be demoted below `nl-starter`.
  it.each([
    'find src',
    'make build',
    'make clean',
    'which node',
  ])('stays a shell command when the rest of the input is not: %s', (input) => {
    const r = classifyInput(input);
    expect(r.type).toBe('shell');
    expect(r.source).toBe('known-command');
  });

  // Flags and paths are caught several rungs earlier and never reach here.
  it.each(['find . -name "*.ts"', 'make -j8', 'find src -type f'])(
    'is decided by syntax before ambiguity matters: %s',
    (input) => {
      expect(classifyInput(input).source).toBe('shell-syntax');
    },
  );

  it('leaves the other 181 known commands untouched', () => {
    expect(classifyInput('git the thing').source).toBe('known-command');
    expect(classifyInput('cat the summary').source).toBe('known-command');
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npm test -- tests/unit/commandDetector.test.ts`
Expected: FAIL — the first group reports `source: 'known-command'` and
`type: 'shell'` instead of `'ambiguous-command'` / `'ai'`. The second and third
groups should already pass.

- [ ] **Step 3: Add the set and the new source**

In `src/utils/commandDetector.ts`, immediately after the `KNOWN_COMMANDS`
declaration (which ends at line 29), add:

```ts
/**
 * Known commands that are also ordinary English verbs.
 *
 * `known-command` sits above `nl-starter`, so without this "find the bug in
 * auth.ts" and "make it faster" classify as shell. Demoting these three below
 * `nl-starter` is the obvious fix and the wrong one: it breaks `make build`,
 * `find src` and `which node`. The first token cannot decide — the rest of the
 * input has to.
 */
const AMBIGUOUS_COMMANDS = new Set(['find', 'make', 'which']);
```

Extend `DecisionSource` with the new member:

```ts
export type DecisionSource =
  | 'empty' | 'agent-cli' | 'shell-syntax' | 'known-command'
  | 'ambiguous-command'
  | 'nl-starter' | 'nl-pronoun' | 'question-mark'
  | 'nl-word-score' | 'shell-token-score' | 'short-token' | 'sticky-fallback';
```

- [ ] **Step 4: Replace the `known-command` rung**

Replace this line in `classifyInput` (currently line 175):

```ts
  if (KNOWN_COMMANDS.has(firstWord)) return { type: 'shell', confidence: H, source: 'known-command' };
```

with:

```ts
  if (KNOWN_COMMANDS.has(firstWord)) {
    // `find`/`make`/`which` are commands AND English verbs. Judge them on what
    // follows: a natural-language word or a pronoun anywhere after the first
    // token means this is a sentence, not an invocation. MED rather than HIGH
    // because it is a genuine judgement call, not a fact about the string.
    if (AMBIGUOUS_COMMANDS.has(firstWord)
        && tokens.slice(1).some(t => nlMatch(t) || PRONOUNS.has(t.toLowerCase()))) {
      return { type: 'ai', confidence: M, source: 'ambiguous-command' };
    }
    return { type: 'shell', confidence: H, source: 'known-command' };
  }
```

- [ ] **Step 5: Run the tests and verify they pass**

```bash
npm test -- tests/unit/commandDetector.test.ts
npm test && npx tsc --noEmit
```
Expected: all green. If a pre-existing test asserted that one of these three
inputs was shell, that test encoded the bug — update it and say so in the commit
body.

- [ ] **Step 6: Commit**

```bash
git add src/utils/commandDetector.ts tests/unit/commandDetector.test.ts
git commit -m "fix(classifier): stop find/make/which swallowing English sentences

known-command sits above nl-starter, so 'find the bug in auth.ts' and 'make it
faster' have been classifying as shell. Three of the 184 known commands are
ordinary English verbs.

Demoting them below nl-starter would break 'make build' and 'find src', so the
first token cannot decide: an NL word or pronoun anywhere after it means the
input is a sentence. Flag forms are caught by shell-syntax several rungs
earlier and never reach this rung.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: The two new cascade rungs

**Files:**
- Modify: `src/utils/commandDetector.ts` — types (`DecisionSource`, `ClassifyContext`) and the cascade in `classifyInput`
- Test: `tests/unit/commandDetector.test.ts` (append)

**Interfaces:**
- Consumes: nothing from Task 1 at runtime — the map is supplied by the caller in Task 5. Task 2 must already have landed: it edits the same rung region.
- Produces:
  - `DecisionSource` gains `'learned' | 'path-binary'`
  - `ClassifyContext` gains `learned?: ReadonlyMap<string, InputType>` and `pathBinaries?: ReadonlySet<string>`

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/commandDetector.test.ts`:

```ts
describe('learned corrections', () => {
  const learned = (m: Record<string, 'shell' | 'ai'>) =>
    ({ learned: new Map(Object.entries(m)) as ReadonlyMap<string, 'shell' | 'ai'> });

  it('overrides the ambiguous-command verdict when the user has taught it otherwise', () => {
    const r = classifyInput('find the config', learned({ find: 'shell' }));
    expect(r.type).toBe('shell');
    expect(r.source).toBe('learned');
    expect(r.confidence).toBe(CONFIDENCE.HIGH);
  });

  it('overrides a known command in the other direction', () => {
    // A personal script named `explain`, or a habit of asking AI to `find`.
    const r = classifyInput('cat the summary', learned({ cat: 'ai' }));
    expect(r.type).toBe('ai');
    expect(r.source).toBe('learned');
  });

  it('leaves untaught tokens on their original rung', () => {
    expect(classifyInput('find the config', learned({ grep: 'ai' })).source).toBe('ambiguous-command');
    expect(classifyInput('explain this to me', learned({ grep: 'ai' })).source).toBe('nl-starter');
  });

  it('keys on the first token only', () => {
    const r = classifyInput('ls find', learned({ find: 'ai' }));
    expect(r.source).toBe('known-command');
    expect(r.type).toBe('shell');
  });

  // The syntax rungs assert facts about the string. `learned` asserts a
  // preference about a vocabulary item, and must never beat a fact.
  it('never beats shell syntax, an agent CLI, or a question mark', () => {
    expect(classifyInput('git log | grep foo', learned({ git: 'ai' })).source).toBe('shell-syntax');
    expect(classifyInput('./deploy now', learned({ deploy: 'ai' })).source).toBe('shell-syntax');
    expect(classifyInput('what is find?', learned({ what: 'shell' })).source).toBe('question-mark');
    expect(classifyInput('claude fix this', learned({ claude: 'ai' })).source).toBe('agent-cli');
  });
});

describe('PATH binaries', () => {
  const onPath = (...names: string[]) => ({ pathBinaries: new Set(names) as ReadonlySet<string> });

  // The point of the rung. KNOWN_COMMANDS covers 184 of the ~4000 binaries on
  // PATH; the rest reach sticky-fallback at LOW (0.55), under FLIP_THRESHOLD,
  // so the composer never auto-flips for them. Note `Rscript` also pins the
  // case-sensitivity of the lookup.
  it('lifts an unknown binary from LOW to MED so the composer auto-flips', () => {
    const before = classifyInput('Rscript analyse.R');
    expect(before.source).toBe('sticky-fallback');
    expect(before.confidence).toBeLessThan(FLIP_THRESHOLD);

    const after = classifyInput('Rscript analyse.R', onPath('Rscript'));
    expect(after.type).toBe('shell');
    expect(after.source).toBe('path-binary');
    expect(after.confidence).toBe(CONFIDENCE.MED);
    expect(after.confidence).toBeGreaterThanOrEqual(FLIP_THRESHOLD);
  });

  // The reason the rung sits BELOW every natural-language rung. These four
  // words are real binaries on a stock Linux box AND natural-language starters,
  // and unlike find/make/which (Task 2) they are classified CORRECTLY today.
  // A high placement would break all four.
  it.each([
    'write the tests for this module',
    'convert this to typescript',
    'compare these two files for me',
    'who owns this service',
  ])('leaves an English sentence alone even when its verb is on PATH: %s', (input) => {
    const r = classifyInput(input, onPath('write', 'convert', 'compare', 'who'));
    expect(r.type).toBe('ai');
    expect(r.source).toBe('nl-starter');
  });

  // Task 2's three verbs must also survive the new rung.
  it('does not let PATH membership undo the ambiguous-command fix', () => {
    const r = classifyInput('find the bug in auth.ts', onPath('find', 'make', 'which'));
    expect(r.type).toBe('ai');
    expect(r.source).toBe('ambiguous-command');
  });

  it('does not fire for a token that is not on PATH', () => {
    expect(classifyInput('Rscript analyse.R', onPath('docker')).source).toBe('sticky-fallback');
  });
});

describe('additive-ness', () => {
  it('behaves identically with an empty context and with none at all', () => {
    for (const input of ['ls -la', 'how do I rebase', 'Rscript analyse.R', 'find the bug']) {
      expect(classifyInput(input, { learned: new Map(), pathBinaries: new Set() }))
        .toEqual(classifyInput(input));
    }
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npm test -- tests/unit/commandDetector.test.ts`
Expected: FAIL — the `learned` tests report `source` as `'ambiguous-command'`/`'known-command'` instead of `'learned'`, and the PATH tests report `'sticky-fallback'` instead of `'path-binary'`. TypeScript will also object to the unknown context properties.

- [ ] **Step 3: Extend the types**

In `src/utils/commandDetector.ts`, replace the `ClassifyContext` interface (line 81) with:

```ts
export interface ClassifyContext {
  /** Current input mode, used for asymmetric stickiness. */
  currentMode?: InputType;
  /**
   * Verdicts learned from the user's pre-submit corrections, keyed on the
   * lowercased first token. Already thresholded by `classifierMemory` — this
   * is a lookup, so `classifyInput` stays pure. Absent disables the rung.
   */
  learned?: ReadonlyMap<string, InputType>;
  /**
   * Basenames of every executable on the LOCAL PATH. Absent disables the rung,
   * which is how remote sessions suppress it: over ssh these names describe
   * the wrong machine.
   */
  pathBinaries?: ReadonlySet<string>;
}
```

Then extend `DecisionSource` (line 86) — add the two new members:

```ts
export type DecisionSource =
  | 'empty' | 'agent-cli' | 'shell-syntax' | 'known-command'
  | 'ambiguous-command'
  | 'nl-starter' | 'nl-pronoun' | 'question-mark' | 'learned'
  | 'nl-word-score' | 'shell-token-score' | 'path-binary'
  | 'short-token' | 'sticky-fallback';
```

- [ ] **Step 4: Insert the `learned` rung**

In `classifyInput`, immediately after the question-mark rung and **before** the `KNOWN_COMMANDS` check (currently line 175), insert:

```ts
  // What the user has taught us, above every other vocabulary rung and below
  // every syntax rung. A correction is a claim about a WORD: it has to beat
  // `known-command`, `ambiguous-command` and `nl-starter` (that is the whole
  // feature) but it must not beat a pipe or a question mark, which are facts
  // about the string.
  const taught = ctx?.learned?.get(firstWord);
  if (taught) return { type: taught, confidence: H, source: 'learned' };
```

- [ ] **Step 5: Insert the `path-binary` rung**

Immediately after the `shell-token-score` rung and **before** the `short-token` rung (currently line 200), insert:

```ts
  // PATH membership, deliberately this low. It looks like a strong shell signal
  // and is not: `write`, `convert`, `compare` and `who` are all real binaries
  // AND natural-language starters, so a high placement would turn "write the
  // tests" into a command. (`find`, `make` and `which` collide too, but they
  // are in KNOWN_COMMANDS and handled by AMBIGUOUS_COMMANDS above.) Down here
  // it is not a shell signal at all — it is a confidence upgrade for input
  // every other rung declined, moving `Rscript analyse.R` from LOW (no
  // auto-flip) to MED (auto-flip). Raw token first: binaries are
  // case-sensitive.
  if (ctx?.pathBinaries?.has(tokens[0]) || ctx?.pathBinaries?.has(firstWord)) {
    return { type: 'shell', confidence: M, source: 'path-binary' };
  }
```

- [ ] **Step 6: Run the tests and verify they pass**

Run: `npm test -- tests/unit/commandDetector.test.ts`
Expected: PASS, including every pre-existing test in the file unchanged.

Then the whole suite and the typecheck:

```bash
npm test && npx tsc --noEmit
```
Expected: 133 files / 1012+ tests passing; `tsc` silent.

- [ ] **Step 7: Commit**

```bash
git add src/utils/commandDetector.ts tests/unit/commandDetector.test.ts
git commit -m "feat(classifier): add the learned and path-binary rungs

Placed asymmetrically, and the asymmetry is the design. Corrections outrank
every vocabulary rung but no syntax rung. PATH membership sits near the bottom:
seven stock binaries are also NL starters, so a high placement would classify
'find the bug in auth.ts' as a command. Down there it is a confidence upgrade
for input nothing else had an opinion about, moving 'kubectl get pods' across
FLIP_THRESHOLD.

Both arrive through ClassifyContext as optional pre-resolved data, so
classifyInput stays pure and is unchanged when neither is supplied.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: The main-process PATH scan

**Files:**
- Create: `electron/services/pathBinaries.ts`
- Test: `tests/unit/pathBinaries.test.ts`
- Modify: `electron/main.ts` — import beside the other services, call beside `setupGitService()`
- Modify: `electron/preload.ts:114-116`
- Modify: `src/types/window.d.ts:73-75`

**Interfaces:**
- Consumes: nothing from Tasks 1, 2 or 3.
- Produces:
  - `scanPathBinaries(pathVar: string, read?: ReadDir): string[]`
  - `setupPathBinariesService(): void`
  - `type ReadDir = (dir: string) => string[]`
  - Renderer API `window.tai.shell.pathBinaries(): Promise<string[]>`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/pathBinaries.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { delimiter } from 'node:path';
import { scanPathBinaries, MAX_BINARIES } from '../../electron/services/pathBinaries';

const P = (...dirs: string[]) => dirs.join(delimiter);

describe('scanPathBinaries', () => {
  it('collects basenames from every directory on PATH', () => {
    const read = (dir: string) => (dir === '/usr/bin' ? ['ls', 'git'] : ['kubectl']);
    expect(scanPathBinaries(P('/usr/bin', '/usr/local/bin'), read).sort())
      .toEqual(['git', 'kubectl', 'ls']);
  });

  it('de-duplicates a binary that shadows another on a later directory', () => {
    const read = () => ['python3'];
    expect(scanPathBinaries(P('/a', '/b'), read)).toEqual(['python3']);
  });

  // A missing or permission-denied directory on PATH is completely ordinary.
  it('skips unreadable directories instead of throwing', () => {
    const read = (dir: string) => {
      if (dir === '/nope') throw new Error('ENOENT');
      return ['ls'];
    };
    expect(scanPathBinaries(P('/nope', '/usr/bin'), read)).toEqual(['ls']);
  });

  it('tolerates an empty PATH and empty segments', () => {
    expect(scanPathBinaries('', () => ['ls'])).toEqual([]);
    expect(scanPathBinaries(P('', '/usr/bin'), () => ['ls'])).toEqual(['ls']);
  });

  it('caps the result so a pathological PATH cannot blow up the IPC payload', () => {
    const read = () => Array.from({ length: MAX_BINARIES + 500 }, (_, i) => `bin${i}`);
    expect(scanPathBinaries('/usr/bin', read).length).toBe(MAX_BINARIES);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test -- tests/unit/pathBinaries.test.ts`
Expected: FAIL — `Cannot find module '../../electron/services/pathBinaries'`.

- [ ] **Step 3: Write the implementation**

Create `electron/services/pathBinaries.ts`:

```ts
import { ipcMain } from 'electron';
import { readdirSync } from 'node:fs';
import { delimiter } from 'node:path';

/**
 * Every executable name on PATH, for the classifier's weakest rung.
 *
 * Entries are NOT stat'ed for the executable bit. There are ~4000 of them on a
 * stock box, and spending 4000 syscalls to slightly narrow the bottom rung of a
 * cascade is not a trade worth making — a false positive there costs a
 * confidence upgrade at most.
 */

export type ReadDir = (dir: string) => string[];

/** Ceiling on the IPC payload; far above any real PATH. */
export const MAX_BINARIES = 20000;

const defaultRead: ReadDir = (dir) =>
  readdirSync(dir, { withFileTypes: true })
    .filter(e => !e.isDirectory())
    .map(e => e.name);

export function scanPathBinaries(pathVar: string, read: ReadDir = defaultRead): string[] {
  const out = new Set<string>();
  for (const dir of pathVar.split(delimiter)) {
    if (!dir) continue;
    if (out.size >= MAX_BINARIES) break;
    try {
      for (const name of read(dir)) out.add(name);
    } catch {
      // Missing or permission-denied directories on PATH are ordinary.
    }
  }
  return [...out].slice(0, MAX_BINARIES);
}

export function setupPathBinariesService(): void {
  let cachedFor: string | null = null;
  let cached: string[] = [];
  ipcMain.handle('shell:pathBinaries', () => {
    const pathVar = process.env.PATH ?? '';
    // Keyed on PATH itself, so a shell that exports a new one is picked up on
    // the next request rather than being stale for the life of the app.
    if (pathVar !== cachedFor) {
      cached = scanPathBinaries(pathVar);
      cachedFor = pathVar;
    }
    return cached;
  });
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npm test -- tests/unit/pathBinaries.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire it through main, preload, and the window types**

In `electron/main.ts`, add the import alongside the other service imports near line 11:

```ts
import { setupPathBinariesService } from './services/pathBinaries';
```

and call it beside `setupGitService();` at line 173:

```ts
  setupPathBinariesService();
```

In `electron/preload.ts`, extend the existing `shell` namespace at line 114:

```ts
  shell: {
    openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
    pathBinaries: () => ipcRenderer.invoke('shell:pathBinaries'),
  },
```

In `src/types/window.d.ts`, extend the matching block at line 73:

```ts
      shell: {
        openExternal: (url: string) => Promise<boolean>;
        pathBinaries: () => Promise<string[]>;
      };
```

- [ ] **Step 6: Verify the whole suite and the typecheck**

```bash
npm test && npx tsc --noEmit
```
Expected: all green; `tsc` silent.

- [ ] **Step 7: Commit**

```bash
git add electron/services/pathBinaries.ts tests/unit/pathBinaries.test.ts \
        electron/main.ts electron/preload.ts src/types/window.d.ts
git commit -m "feat(shell): expose the local PATH binary set to the renderer

One readdir per PATH entry, no per-file stat for the exec bit — 4000 syscalls
to narrow the classifier's weakest rung is not worth it, and a false positive
there costs a confidence upgrade at most. Cached against PATH itself, so a
shell exporting a new one is picked up rather than being stale for the life of
the app. Unreadable directories are skipped.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Wire it into the composer

**Files:**
- Modify: `src/components/TerminalInput.tsx` — imports (line 5), state (lines 146-157), Shift-Tab handler (lines 276-281), `handleChange` classification (lines 456-461)

**Interfaces:**
- Consumes: `loadLearnedVerdicts`, `recordCorrection` (Task 1); `ClassifyContext.learned` / `.pathBinaries` (Task 3); `window.tai.shell.pathBinaries()` (Task 4).
- Produces: nothing consumed by later tasks — this is the last one.

**Background the implementer needs.** `TerminalInput` already tracks `manualOverride` (line 151): it is set `true` when the user forces a mode and `false` when the field is cleared, and auto-flipping is skipped while it is `true`. Two consequences shape this task:

1. Corrections are recorded **only when `manualOverride` is false** at the moment of the Shift-Tab — i.e. only the first toggle for a given input. After that the classifier has stopped classifying, so the retained decision is stale, and repeated Shift-Tab presses would otherwise pump the counts on a single input.
2. The rung that made the decision has to be retained, because `recordCorrection` needs it. `handleChange` currently discards everything but `type` and `confidence`.

- [ ] **Step 1: Import the new helpers**

At line 5, extend the existing import and add the memory module:

```ts
import { classifyInput, FLIP_THRESHOLD, type ClassificationResult } from '@/utils/commandDetector';
import { loadLearnedVerdicts, recordCorrection } from '@/utils/classifierMemory';
```

- [ ] **Step 2: Add the two context inputs and the retained decision**

After the `manualOverride` state at line 151, add:

```ts
  // What the user has taught the classifier. Loaded once per mount: the map is
  // small, and a correction made in this composer is applied on the next
  // keystroke via the ref below rather than by re-reading storage.
  const learnedRef = useRef(loadLearnedVerdicts(localStorage));
  // Local PATH binaries. Left null on a remote prompt — over ssh these names
  // describe the wrong machine — which disables the rung by omission.
  const [pathBinaries, setPathBinaries] = useState<ReadonlySet<string> | null>(null);
  // The decision the last keystroke produced, so a Shift-Tab knows which rung
  // it is correcting. `recordCorrection` discards corrections against rungs
  // that sit above `learned` in the cascade.
  const lastDecisionRef = useRef<{ input: string; result: ClassificationResult } | null>(null);
```

Then, alongside the component's other effects, add the fetch:

```ts
  useEffect(() => {
    let cancelled = false;
    void window.tai.shell.pathBinaries().then(names => {
      if (!cancelled) setPathBinaries(new Set(names));
    }).catch(() => { /* the rung simply stays disabled */ });
    return () => { cancelled = true; };
  }, []);
```

- [ ] **Step 3: Build the context and retain the decision in `handleChange`**

Replace the classification block at lines 456-461 with:

```ts
    if (!manualOverride) {
      const result = classifyInput(trimmed, {
        currentMode: mode,
        learned: learnedRef.current,
        // Omitted on a remote prompt: PATH was scanned locally, so over ssh
        // these names belong to the wrong computer.
        pathBinaries: promptInfo?.isRemote ? undefined : (pathBinaries ?? undefined),
      });
      lastDecisionRef.current = { input: trimmed, result };
      if (result.confidence >= FLIP_THRESHOLD && result.type !== mode) {
        onModeChange(result.type);
      }
    }
```

- [ ] **Step 4: Record the correction on Shift-Tab**

Replace the Shift-Tab branch at lines 276-281 with exactly this:

```ts
    if (e.key === 'Tab' && e.shiftKey) {
      e.preventDefault();
      const corrected: InputMode = mode === 'shell' ? 'ai' : 'shell';
      const last = lastDecisionRef.current;
      // Three clauses, each load-bearing:
      //   !manualOverride  — teach only on the FIRST toggle for this input.
      //                      After it is set the classifier stops running, so
      //                      the retained decision is stale and repeated
      //                      presses would pump the counts on one input.
      //   last.input === … — the retained decision must describe what is in
      //                      the field right now, not an earlier keystroke.
      //   type !== corrected — only record when the classifier actually held
      //                      the opposing opinion; agreeing is not a correction.
      if (!manualOverride && last && last.input === value.trim() && last.result.type !== corrected) {
        recordCorrection(last.input, corrected, last.result.source, localStorage);
        learnedRef.current = loadLearnedVerdicts(localStorage);
      }
      setManualOverride(true);
      onModeChange(corrected);
      return;
    }
```

Note `InputMode` is the component's existing mode type; `classifyInput` returns the structurally identical `InputType`. If TypeScript objects to assigning one to the other, import `InputType` from `@/utils/commandDetector` and use it for the `corrected` local instead — both are `'shell' | 'ai'`.

- [ ] **Step 5: Verify**

```bash
npm test && npx tsc --noEmit
```
Expected: all green; `tsc` silent. No new test file for this task — `TerminalInput` is a React component whose classifier behaviour is already covered by the pure-function tests in Tasks 1-3; the wiring is verified in the app in Step 6.

- [ ] **Step 6: Verify in the app**

Run `npm run dev` and check all four behaviours by hand:

1. Type `Rscript analyse.R`, or any binary you have that is not one of the 184 in `KNOWN_COMMANDS` — the composer auto-flips to shell (it did not before).
2. Type `find the bug in auth.ts` — stays in AI mode, despite `find` being both a known command and on PATH. Then type `find src` and confirm it is still shell.
3. Type `find something`, Shift-Tab to shell, clear the field, repeat. On the third attempt `find …` should classify as shell immediately.
4. `ssh` to a host, then type an input whose first word is a local-only binary — it must not auto-flip on PATH membership.

- [ ] **Step 7: Commit**

```bash
git add src/components/TerminalInput.tsx
git commit -m "feat(composer): feed learned corrections and PATH into the classifier

Shift-Tab now teaches. Only the first toggle for an input counts: after
manualOverride is set the classifier stops running, so the retained decision is
stale and repeated presses would pump the counts on a single input.

PATH is omitted on a remote prompt, which disables the rung by omission — the
names were scanned locally and describe the wrong machine over ssh.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage.** Spec Problem §3 (`find`/`make`/`which`) → Task 2. §1 rung
placement → Task 3 Steps 4-5. §1 new `DecisionSource` values → Task 3 Step 3
(plus `'ambiguous-command'` in Task 2 Step 3). §2 `ClassifyContext` → Task 3
Step 3. §3 store, counting, both caps, excluded sources and token shapes →
Task 1. §3's deliberately-excluded force-shell prefix → correctly absent from
Task 5, which touches only the Shift-Tab branch. §4 PATH scan → Task 4. §4
remote suppression → Task 5 Step 3. Spec Testing section → Tasks 1 Step 1,
2 Step 1, 3 Step 1, 4 Step 1. No gaps.

**Type consistency.** `LearnStore` (Task 1) is satisfied by `localStorage`
(Task 5). `DecisionSource` flows Task 2 → Task 3 → Task 1's `recordCorrection`
signature → Task 5's call site, and the Task 3 declaration retains
`'ambiguous-command'` from Task 2. `ReadonlyMap<string, InputType>` matches
between `loadLearnedVerdicts`'s return and `ClassifyContext.learned`.
`ReadonlySet<string>` matches between Task 5's `new Set(names)` and
`ClassifyContext.pathBinaries`. `MAX_BINARIES` is exported in Task 4 because
Task 4's test imports it.

**Placeholder scan.** Clean. An earlier draft of Task 5 showed a discarded
sketch of the Shift-Tab guard before giving the real one; that has been
collapsed into a single step with the three clauses annotated inline.

**Ordering.** Task 2 must precede Task 3 — both edit the same rung region of
`classifyInput`, and Task 3's tests assert `'ambiguous-command'`, which Task 2
introduces. Tasks 1 and 4 are independent of everything until Task 5.
