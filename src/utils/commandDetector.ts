const KNOWN_COMMANDS = new Set([
  'cd', 'ls', 'll', 'la', 'pwd', 'echo', 'cat', 'head', 'tail', 'less', 'more',
  'cp', 'mv', 'rm', 'mkdir', 'rmdir', 'touch', 'chmod', 'chown', 'chgrp', 'ln',
  'find', 'grep', 'rg', 'ag', 'sed', 'awk', 'sort', 'uniq', 'wc', 'tr', 'cut',
  'diff', 'patch', 'file', 'which', 'whereis', 'type', 'alias', 'unalias',
  'export', 'unset', 'source', 'eval', 'exec', 'exit', 'clear', 'reset',
  'history', 'true', 'false', 'test', 'read', 'printf', 'set',
  'du', 'df', 'mount', 'umount', 'tar', 'zip', 'unzip', 'gzip', 'gunzip', 'bzip2',
  'xz', 'zcat', 'stat', 'dd', 'rsync', 'scp',
  'ps', 'top', 'htop', 'btop', 'kill', 'killall', 'pkill', 'fg', 'bg', 'jobs',
  'nohup', 'xargs', 'time', 'watch', 'uptime', 'free', 'uname', 'hostname',
  'whoami', 'id', 'su', 'sudo', 'doas', 'env', 'man', 'info', 'tee',
  'curl', 'wget', 'ssh', 'ping', 'nc', 'netstat', 'ss', 'ip', 'ifconfig',
  'dig', 'nslookup', 'traceroute', 'host',
  'git', 'gh', 'npm', 'npx', 'yarn', 'pnpm', 'bun', 'deno', 'node', 'tsx', 'ts-node',
  'python', 'python3', 'pip', 'pip3', 'pipenv', 'poetry', 'uv', 'uvx',
  'ruby', 'gem', 'bundle', 'rake', 'rails',
  'go', 'cargo', 'rustc', 'rustup',
  'java', 'javac', 'mvn', 'gradle',
  'make', 'cmake', 'gcc', 'g++', 'clang',
  'docker', 'podman', 'kubectl', 'helm',
  'terraform', 'ansible', 'vagrant',
  'vim', 'nvim', 'vi', 'nano', 'emacs', 'code', 'micro',
  'apt', 'apt-get', 'dnf', 'yum', 'pacman', 'brew', 'flatpak', 'snap',
  'jq', 'yq', 'tree', 'bat', 'eza', 'exa', 'fd', 'fzf', 'tmux', 'screen',
  'systemctl', 'journalctl', 'lsof', 'strace',
]);

// CLI agents that TAI wraps as AI providers. When typed as the first token
// these are real shell commands (launching the CLI), but their natural-language
// arguments ("claude how do I fix this") would otherwise classify as AI and
// misroute the launch into the provider instead of running the binary. Always
// treat them as shell. Mirrors Warp's input_classifier guardrail.
const WRAPPED_AGENT_CLIS = new Set(['claude', 'codex', 'gemini']);

const NL_STARTERS = /^(what|why|how|when|where|who|which|can|could|would|should|is|are|do|does|did|will|shall|tell|explain|help|show|describe|fix|find|list|create|make|write|give|suggest|compare|check|analyze|summarize|refactor|debug|implement|add|remove|update|change|convert|translate|generate|optimize|review|please|hey|hi|sorry|thanks|thank)\b/i;

const NL_WORDS = new Set([
  'there', 'here', 'ok', 'okay', 'hold', 'wait', 'but', 'so',
  'actually', 'maybe', 'also', 'just', 'well', 'yeah', 'yes', 'no',
  'nah', 'nope', 'hmm', 'hm', 'ah', 'oh', 'ooh', 'um', 'uh',
  'never', 'always', 'only', 'not', 'dont', 'like', 'let', 'lets',
  'i', 'im', 'its', 'thats', 'whats', 'heres', 'theres',
  'in', 'on', 'at', 'to', 'the', 'a', 'an', 'it', 'we',
  'yep', 'looks', 'good', 'great', 'nice', 'cool', 'sure', 'perfect',
  'sounds', 'awesome', 'fine', 'right', 'correct', 'exactly',
  'that', 'this', 'these', 'those', 'some', 'any', 'every',
  'pretty', 'really', 'very', 'quite', 'super', 'totally',
  'id', 'ill', 'ive', 'youre', 'youll', 'youd', 'youve',
  'wed', 'weve', 'were', 'theyre', 'theyd', 'theyve', 'theyll',
  'hes', 'shes', 'hed', 'shed', 'itll', 'wont', 'cant', 'didnt',
  'doesnt', 'isnt', 'arent', 'wasnt', 'werent', 'hasnt', 'havent',
  'wouldnt', 'couldnt', 'shouldnt', 'mustnt',
]);

const PRONOUNS = new Set([
  'i', 'me', 'my', 'you', 'your', 'we', 'our', 'they', 'their',
  'he', 'she', 'him', 'her', 'us', 'them',
]);

const SENTENCE_WORDS = new Set([
  'the', 'a', 'an', 'this', 'that', 'these', 'those', 'some', 'any', 'every',
  'of', 'for', 'with', 'about', 'into', 'from', 'between', 'through', 'during',
  'before', 'after', 'above', 'below', 'under', 'over',
  'and', 'or', 'but', 'because', 'since', 'although', 'whether', 'wether', 'while',
  'if', 'then', 'than', 'either', 'neither',
  'have', 'has', 'had', 'was', 'were', 'been', 'being', 'am', 'are', 'is',
  'do', 'does', 'did', 'done', 'doing',
  'get', 'got', 'getting', 'gets',
  'know', 'known', 'knew', 'think', 'thought', 'want', 'need', 'see', 'saw', 'seen',
  'going', 'gonna', 'wanna', 'gotta',
  'not', 'very', 'really', 'already', 'still', 'even', 'probably', 'definitely',
]);

export type InputType = 'shell' | 'ai';

export interface ClassifyContext {
  /** Current input mode, used for asymmetric stickiness. */
  currentMode?: InputType;
}

export type DecisionSource =
  | 'empty' | 'agent-cli' | 'shell-syntax' | 'known-command'
  | 'nl-starter' | 'nl-pronoun' | 'question-mark'
  | 'nl-word-score' | 'shell-token-score' | 'short-token' | 'sticky-fallback';

export interface ClassificationResult {
  type: InputType;
  /** 0..1 — synthesized rule-strength, not a true probability. */
  confidence: number;
  source: DecisionSource;
}

export const CONFIDENCE = { HIGH: 0.95, MED: 0.75, LOW: 0.55 } as const;

/** Minimum confidence required for a consumer to auto-flip the input mode. */
export const FLIP_THRESHOLD = 0.7;

const END_TOKEN_COMPLETE = new Set([' ', '?', '!', '.', '"', ',']);

function tokenHasShellSyntax(token: string): boolean {
  return /[|><;&$*?{}()[\]]/.test(token) || /^-{1,2}[a-zA-Z]/.test(token);
}

function nlScore(tokens: string[]): number {
  if (tokens.length === 0) return 0;
  const hits = tokens.filter(t => {
    const w = t.toLowerCase();
    return NL_WORDS.has(w) || SENTENCE_WORDS.has(w);
  }).length;
  return hits / tokens.length;
}

function shellScore(tokens: string[]): number {
  if (tokens.length === 0) return 0;
  const hits = tokens.filter((t, i) => {
    if (i === 0 && KNOWN_COMMANDS.has(t.toLowerCase())) return true;
    return tokenHasShellSyntax(t);
  }).length;
  return hits / tokens.length;
}

function nlThreshold(n: number): number {
  if (n <= 3) return 1.0;
  if (n <= 4) return 0.8;
  return 0.6;
}

function shellThreshold(n: number): number {
  if (n <= 2) return 1.0;
  if (n <= 4) return 0.7;
  return 0.5;
}

export function classifyInput(input: string, ctx?: ClassifyContext): ClassificationResult {
  const trimmed = input.trim();
  if (!trimmed) return { type: 'ai', confidence: 0, source: 'empty' };

  const tokens = trimmed.split(/\s+/);
  const firstWord = tokens[0].toLowerCase();
  const H = CONFIDENCE.HIGH;
  const M = CONFIDENCE.MED;
  const L = CONFIDENCE.LOW;

  // Wrapped agent CLI launch — always shell, ahead of every NL signal.
  if (WRAPPED_AGENT_CLIS.has(firstWord)) return { type: 'shell', confidence: H, source: 'agent-cli' };

  // Explicit shell syntax.
  if (/^[.~/]/.test(trimmed)) return { type: 'shell', confidence: H, source: 'shell-syntax' };
  if (/^[A-Z_][A-Z0-9_]*=/.test(trimmed)) return { type: 'shell', confidence: H, source: 'shell-syntax' };
  if (/[|><;&]/.test(trimmed)) return { type: 'shell', confidence: H, source: 'shell-syntax' };
  if (/\s-{1,2}[a-zA-Z]/.test(trimmed)) return { type: 'shell', confidence: H, source: 'shell-syntax' };

  // Question mark is a strong natural-language signal.
  if (trimmed.includes('?')) return { type: 'ai', confidence: H, source: 'question-mark' };

  // Known command as the first token.
  if (KNOWN_COMMANDS.has(firstWord)) return { type: 'shell', confidence: H, source: 'known-command' };

  // Leading natural-language starter ("how", "explain", "please", ...).
  if (NL_STARTERS.test(trimmed)) return { type: 'ai', confidence: H, source: 'nl-starter' };

  // A pronoun anywhere is a strong conversational signal.
  if (tokens.some(w => PRONOUNS.has(w.toLowerCase()))) return { type: 'ai', confidence: H, source: 'nl-pronoun' };

  // Natural-language word scoring, token-count-scaled. Classify with AND
  // without a still-being-typed last token; AI wins (mirrors Warp).
  const lastChar = trimmed[trimmed.length - 1];
  const lastComplete = END_TOKEN_COMPLETE.has(lastChar);
  let nlPass = nlScore(tokens) >= nlThreshold(tokens.length);
  if (!nlPass && !lastComplete && tokens.length > 2) {
    const dropped = tokens.slice(0, -1);
    nlPass = nlScore(dropped) >= nlThreshold(dropped.length);
  }
  if (nlPass) return { type: 'ai', confidence: M, source: 'nl-word-score' };

  if (shellScore(tokens) >= shellThreshold(tokens.length)) {
    return { type: 'shell', confidence: M, source: 'shell-token-score' };
  }

  // A lone unknown token is probably a command.
  if (tokens.length === 1 && /^[a-z0-9_][\w.-]*$/i.test(firstWord)) {
    return { type: 'shell', confidence: L, source: 'short-token' };
  }

  // No decisive signal — stay in the current mode rather than guess.
  return { type: ctx?.currentMode ?? 'shell', confidence: L, source: 'sticky-fallback' };
}

export function looksLikeShellCommand(input: string): boolean {
  if (!input.trim()) return false;
  return classifyInput(input).type === 'shell';
}
