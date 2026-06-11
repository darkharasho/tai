export interface OutputWindow {
  text: string;
  /** Number of lines dropped from the original text. */
  hidden: number;
}

/** First `max` lines of `text`; the full text is never mutated, only sliced. */
export function headLines(text: string, max: number): OutputWindow {
  if (!text) return { text: '', hidden: 0 };
  const lines = text.split('\n');
  if (lines.length <= max) return { text, hidden: 0 };
  return { text: lines.slice(0, max).join('\n'), hidden: lines.length - max };
}

/** Last `max` lines of `text` — the live tail of a streaming command. */
export function tailLines(text: string, max: number): OutputWindow {
  if (!text) return { text: '', hidden: 0 };
  const lines = text.split('\n');
  if (lines.length <= max) return { text, hidden: 0 };
  return { text: lines.slice(lines.length - max).join('\n'), hidden: lines.length - max };
}
