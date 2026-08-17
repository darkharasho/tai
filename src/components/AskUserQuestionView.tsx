import { useState } from 'react';
import { Check } from 'lucide-react';
import { joinAnswer, answerHasLabel, type AskQuestion } from '@/utils/askUserQuestion';
import styles from './AskUserQuestionView.module.css';

interface AskUserQuestionViewProps {
  questions: AskQuestion[];
  /**
   * Answers already sent (question text -> answer). Present once the call is
   * resolved, which switches the card to a read-only summary of what was sent.
   */
  answers?: Record<string, string>;
  /** Omitted for resolved or restored cards, which are display-only. */
  onSubmit?: (answers: Record<string, string>) => void;
  /** Declines the question — the tool reports that nobody answered. */
  onSkip?: () => void;
}

/**
 * Renders an AskUserQuestion tool payload as the question it actually is, and
 * lets the user answer it. The picks travel back as the tool's `updatedInput`,
 * so allowing the call and answering it are the same gesture.
 */
export function AskUserQuestionView({ questions, answers, onSubmit, onSkip }: AskUserQuestionViewProps) {
  // Per-question index -> chosen labels. Single-select keeps at most one.
  const [picks, setPicks] = useState<Record<number, string[]>>({});
  // "Other" is exclusive: typing free text replaces the picks for that question
  // rather than adding to them, so an answer is never half structured.
  const [other, setOther] = useState<Record<number, string>>({});
  const [otherOpen, setOtherOpen] = useState<Record<number, boolean>>({});

  const interactive = !!onSubmit && !answers;

  function answerFor(qi: number): string {
    if (otherOpen[qi]) return other[qi]?.trim() ?? '';
    return joinAnswer(picks[qi] ?? []);
  }

  function toggle(qi: number, q: AskQuestion, label: string) {
    setOtherOpen(prev => ({ ...prev, [qi]: false }));
    setPicks(prev => {
      const current = prev[qi] ?? [];
      if (!q.multiSelect) return { ...prev, [qi]: current[0] === label ? [] : [label] };
      return {
        ...prev,
        [qi]: current.includes(label) ? current.filter(l => l !== label) : [...current, label],
      };
    });
  }

  const complete = questions.every((_q, qi) => answerFor(qi).length > 0);

  function submit() {
    if (!onSubmit || !complete) return;
    const out: Record<string, string> = {};
    questions.forEach((q, qi) => { out[q.question] = answerFor(qi); });
    onSubmit(out);
  }

  function isChosen(qi: number, q: AskQuestion, label: string): boolean {
    if (answers) {
      const sent = answers[q.question];
      return !!sent && answerHasLabel(sent, label);
    }
    return (picks[qi] ?? []).includes(label);
  }

  return (
    <div className={styles.wrap}>
      {questions.map((q, qi) => (
        <div key={qi} className={styles.question}>
          {q.header && <div className={styles.header}>{q.header}</div>}
          <div className={styles.text}>{q.question}</div>
          {q.options.length > 0 && (
            <div className={styles.options}>
              {q.options.map((opt, oi) => {
                const chosen = isChosen(qi, q, opt.label);
                const cls = `${styles.option}${chosen ? ` ${styles.optionChosen}` : ''}`;
                const body = (
                  <>
                    <span className={q.multiSelect ? styles.markerBox : styles.marker}>
                      {chosen && <span className={styles.markerFill} />}
                    </span>
                    <span className={styles.optionText}>
                      <span className={styles.optionLabel}>{opt.label}</span>
                      {opt.description && <span className={styles.optionDesc}>{opt.description}</span>}
                    </span>
                  </>
                );
                return interactive ? (
                  <button
                    key={oi}
                    type="button"
                    className={cls}
                    aria-pressed={chosen}
                    onClick={() => toggle(qi, q, opt.label)}
                  >
                    {body}
                  </button>
                ) : (
                  <div key={oi} className={cls}>{body}</div>
                );
              })}
            </div>
          )}

          {interactive && (
            <div className={styles.otherRow}>
              {otherOpen[qi] ? (
                <input
                  className={styles.otherInput}
                  autoFocus
                  placeholder="Type your own answer…"
                  aria-label={`Other answer for: ${q.question}`}
                  value={other[qi] ?? ''}
                  onChange={e => setOther(prev => ({ ...prev, [qi]: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
                />
              ) : (
                <button
                  type="button"
                  className={styles.otherBtn}
                  onClick={() => {
                    setOtherOpen(prev => ({ ...prev, [qi]: true }));
                    setPicks(prev => ({ ...prev, [qi]: [] }));
                  }}
                >
                  Other…
                </button>
              )}
            </div>
          )}

          {!interactive && answers?.[q.question] && !q.options.some(o => isChosen(qi, q, o.label)) && (
            <div className={styles.freeAnswer}>
              <Check size={11} /> {answers[q.question]}
            </div>
          )}

          {q.multiSelect && <div className={styles.hint}>select one or more</div>}
        </div>
      ))}

      {interactive && (
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.submit}
            disabled={!complete}
            onClick={submit}
          >
            Send answer
          </button>
          {onSkip && <button type="button" className={styles.skip} onClick={onSkip}>Skip</button>}
        </div>
      )}
    </div>
  );
}
