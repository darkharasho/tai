import { parse as shellParse } from 'shell-quote';

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

export function looksLikeShellCommand(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed) return false;

  // Wrapped agent CLIs are always shell launches, even with NL-looking args or
  // a trailing '?' — checked before any natural-language short-circuit below.
  if (WRAPPED_AGENT_CLIS.has(trimmed.split(/\s+/)[0].toLowerCase())) return true;

  if (/^[.~\/]/.test(trimmed)) return true;
  if (/^[A-Z_][A-Z0-9_]*=/.test(trimmed)) return true;
  if (/[|><;&]/.test(trimmed)) return true;
  if (/\s-{1,2}[a-zA-Z]/.test(trimmed)) return true;
  if (trimmed.includes('?')) return false;

  const firstWord = trimmed.split(/\s+/)[0].toLowerCase();

  if (KNOWN_COMMANDS.has(firstWord)) return true;
  if (NL_STARTERS.test(trimmed)) return false;
  if (NL_WORDS.has(firstWord)) return false;
  if (trimmed.length === 1) return false;
  if (!trimmed.includes(' ')) return true;

  const words = trimmed.split(/\s+/);
  if (words.length <= 3 && /^[a-z0-9_][\w.-]*$/i.test(firstWord)) return true;
  if (words.some(w => PRONOUNS.has(w.toLowerCase()))) return false;

  const nlCount = words.filter(w => SENTENCE_WORDS.has(w.toLowerCase())).length;
  if (nlCount >= 2) return false;

  try {
    const parsed = shellParse(trimmed);
    const hasShellTokens = parsed.some(t => typeof t === 'object');
    if (hasShellTokens) return true;
  } catch {}

  if (/^[a-z0-9_][\w.-]*$/i.test(firstWord)) return true;

  return false;
}
