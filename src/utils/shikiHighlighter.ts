import { type Highlighter, createHighlighter } from 'shiki';

const LANG_MAP: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript',
  js: 'javascript', jsx: 'javascript',
  py: 'python',
  json: 'json',
  css: 'css',
  html: 'html',
  md: 'markdown',
  yaml: 'yaml', yml: 'yaml',
  rs: 'rust',
  go: 'go',
  sh: 'bash', bash: 'bash',
  toml: 'toml',
};

const THEME = 'github-dark';

export function detectLangFromPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase();
  return (ext && LANG_MAP[ext]) || 'text';
}

let highlighterPromise: Promise<Highlighter> | null = null;

function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: [THEME],
      langs: Object.values(LANG_MAP).filter((v, i, a) => a.indexOf(v) === i),
    });
  }
  return highlighterPromise;
}

export async function highlightCode(code: string, lang: string): Promise<string> {
  if (lang === 'text' || lang === 'diff') return '';
  try {
    const highlighter = await getHighlighter();
    return highlighter.codeToHtml(code, { lang, theme: THEME });
  } catch {
    return '';
  }
}
