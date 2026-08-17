export interface AskOption {
  label: string;
  description?: string;
}

export interface AskQuestion {
  question: string;
  header?: string;
  options: AskOption[];
  multiSelect: boolean;
}

/**
 * Pull the questions out of an AskUserQuestion tool input so the approval card
 * can render them instead of dumping the raw JSON payload at the user.
 * Returns null for anything that does not look like the expected shape, which
 * leaves the caller on its generic string rendering.
 */
export function parseAskUserQuestion(input: unknown): AskQuestion[] | null {
  const raw = typeof input === 'string' ? safeParse(input) : input;
  if (!raw || typeof raw !== 'object') return null;
  const list = (raw as { questions?: unknown }).questions;
  if (!Array.isArray(list) || list.length === 0) return null;

  const questions: AskQuestion[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const q = entry as Record<string, unknown>;
    if (typeof q.question !== 'string' || !q.question) continue;
    questions.push({
      question: q.question,
      header: typeof q.header === 'string' && q.header ? q.header : undefined,
      options: Array.isArray(q.options) ? q.options.flatMap(toOption) : [],
      multiSelect: q.multiSelect === true,
    });
  }
  return questions.length ? questions : null;
}

/**
 * Fold the user's picks into the tool input we hand back as `updatedInput`.
 *
 * The CLI re-reads the input when the call is allowed and treats an `answers`
 * map (question text -> answer, multi-select joined with commas) as the user's
 * reply; without it the tool result is "The user did not answer the questions."
 */
export function withAnswers(input: unknown, answers: Record<string, string>): Record<string, unknown> {
  const raw = typeof input === 'string' ? safeParse(input) : input;
  const base = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return { ...base, answers };
}

/** Join a multi-select pick into the single string the tool expects. */
export function joinAnswer(labels: string[]): string {
  return labels.join(SEP);
}

/**
 * Whether a sent answer picked `label`, for re-marking a resolved card.
 *
 * Labels are free to contain ", " themselves ("No, stop"), so this matches on
 * separator boundaries instead of splitting — which would both shred such a
 * label and let one option match a prefix of another.
 */
export function answerHasLabel(answer: string, label: string): boolean {
  if (!label) return false;
  return answer === label
    || answer.startsWith(label + SEP)
    || answer.endsWith(SEP + label)
    || answer.includes(SEP + label + SEP);
}

const SEP = ', ';

function toOption(value: unknown): AskOption[] {
  if (typeof value === 'string') return value ? [{ label: value }] : [];
  if (!value || typeof value !== 'object') return [];
  const o = value as Record<string, unknown>;
  if (typeof o.label !== 'string' || !o.label) return [];
  return [{
    label: o.label,
    description: typeof o.description === 'string' && o.description ? o.description : undefined,
  }];
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
