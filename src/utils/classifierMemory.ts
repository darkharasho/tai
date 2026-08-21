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
export const UNLEARNABLE_SOURCES: ReadonlySet<DecisionSource> = new Set<DecisionSource>([
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
    // A malformed entry (e.g. `{"foo": null}`, or non-numeric counts from a
    // corrupt store) is treated as total 0 so it sorts first for eviction
    // rather than throwing or poisoning the sort with NaN. `read()` only
    // validates the top level is an object, so entries this deep are not
    // guaranteed well-formed by the time eviction runs.
    const total = (t: string) => {
      const c = map[t];
      if (!c || typeof c.ai !== 'number' || typeof c.shell !== 'number') return 0;
      return c.ai + c.shell;
    };
    tokens
      .filter(t => t !== token)
      .sort((a, b) => total(a) - total(b))
      .slice(0, tokens.length - MAX_TOKENS)
      .forEach(t => { delete map[t]; });
  }

  write(store, map);
}
