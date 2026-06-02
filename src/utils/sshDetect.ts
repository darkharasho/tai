// SSH-session detection, ported from Warp's two-signal design
// (warpdotdev/warp `app/src/terminal/ssh/util.rs`, AGPLv3 reference).
//
// Signal 1 — `parseInteractiveSshCommand`: tokenize the command and decide
// whether it launches an *interactive* SSH shell (vs. a one-shot remote
// command, a tunnel, or git-over-ssh). The host comes from the command, not
// from the remote prompt.
//
// Signal 2 — `checkSshLoginState`: classify block output to tell whether the
// remote session has actually come up / is still authenticating, without
// relying on the remote prompt containing `user@host`.

export interface InteractiveSshCommand {
  /** Connection target (`host` or `user@host`); null for ssh-like wrappers. */
  host: string | null;
  /** Port from `-p`, if given. */
  port: string | null;
}

/**
 * Minimal POSIX-ish word splitter (single/double quotes, backslash escapes).
 * Returns null on unterminated quotes — mirrors `shell_words::split` bailing.
 */
function splitWords(input: string): string[] | null {
  const words: string[] = [];
  let cur = '';
  let started = false;
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quote === "'") {
      if (ch === "'") quote = null;
      else cur += ch;
      continue;
    }
    if (quote === '"') {
      if (ch === '"') quote = null;
      else if (ch === '\\' && i + 1 < input.length && (input[i + 1] === '"' || input[i + 1] === '\\')) {
        cur += input[++i];
      } else cur += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      started = true;
      continue;
    }
    if (ch === '\\' && i + 1 < input.length) {
      cur += input[++i];
      started = true;
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\n') {
      if (started) {
        words.push(cur);
        cur = '';
        started = false;
      }
      continue;
    }
    cur += ch;
    started = true;
  }

  if (quote !== null) return null; // unterminated quote
  if (started) words.push(cur);
  return words;
}

// SSH-like wrappers that open an interactive remote session but whose host we
// don't attempt to parse.
const SSH_LIKE_WRAPPERS: ReadonlyArray<readonly string[]> = [
  ['gcloud', 'compute', 'ssh'],
  ['eb', 'ssh'],
  ['doctl', 'compute', 'ssh'],
];

// `ssh` flags that take a separate argument (so the next token is consumed and
// must not be mistaken for the host). `-p` is handled separately for the port.
const SSH_OPTS_WITH_ARG = new Set([
  '-B', '-b', '-c', '-D', '-E', '-e', '-F', '-I', '-i', '-J', '-L',
  '-l', '-m', '-O', '-o', '-P', '-Q', '-R', '-S', '-w',
]);

/**
 * Returns the parsed target of an interactive SSH command, or null if the
 * command is not an interactive SSH session (one-shot remote command, tunnel,
 * `-T`/`-W`, non-ssh, or malformed).
 */
export function parseInteractiveSshCommand(command: string): InteractiveSshCommand | null {
  const stripped = command.startsWith('command ') ? command.slice('command '.length) : command;
  const tokens = splitWords(stripped);
  if (!tokens || tokens.length === 0) return null;

  if (tokens[0] !== 'ssh') {
    for (const wrapper of SSH_LIKE_WRAPPERS) {
      if (wrapper.every((w, idx) => tokens[idx] === w) && tokens.length > wrapper.length) {
        return { host: null, port: null };
      }
    }
    return null;
  }

  let host: string | null = null;
  let port: string | null = null;

  for (let i = 1; i < tokens.length; i++) {
    const tok = tokens[i];
    // -T (no pty) and -W (stdio forward) imply a non-interactive session.
    if (tok === '-T' || tok === '-W') return null;
    if (tok === '-p') {
      i++;
      if (i >= tokens.length) return null;
      port = tokens[i];
      continue;
    }
    if (SSH_OPTS_WITH_ARG.has(tok)) {
      i++; // skip this flag's argument
      continue;
    }
    if (tok.startsWith('-')) continue; // flag that doesn't change interactivity
    // Positional argument.
    if (host !== null) return null; // a second positional ⇒ one-shot remote command
    host = tok;
  }

  // `ssh` with no host at all is malformed for our purposes.
  if (host === null) return null;
  return { host, port };
}

export type SshLoginState = 'last-login' | 'authenticating' | 'prompt-detected' | 'non-ssh-output';

// Common final prompt characters followed by a space (ported from Warp).
const PROMPT_CHAR_RE = /[$#%>❯│⟫»▶λ→] $/;

/**
 * Classifies block output to determine SSH login progress. The host comes from
 * the command; this answers "are we in the remote shell yet, or still
 * authenticating?" without depending on a `user@host` prompt.
 */
export function checkSshLoginState(blockOutput: string): SshLoginState {
  let lastLine: string | null = null;
  for (const line of blockOutput.split('\n')) {
    if (line.startsWith('Last login:')) return 'last-login';
    lastLine = line;
  }

  if (lastLine === null) return 'authenticating';

  if (
    lastLine.includes('password') ||
    lastLine.includes('Password') ||
    lastLine.includes('passphrase') ||
    lastLine.includes('yes/no') ||
    lastLine.includes('Please type') ||
    lastLine.includes("'yes'") ||
    lastLine.includes('Confirm user presence') ||
    lastLine.startsWith('Enter ') ||
    lastLine.startsWith('Allow ')
  ) {
    return 'authenticating';
  }

  if (PROMPT_CHAR_RE.test(lastLine)) return 'prompt-detected';
  return 'non-ssh-output';
}

export type SshErrorKind =
  | 'control-master'
  | 'connection-refused'
  | 'timeout'
  | 'auth-failed'
  | 'host-key'
  | 'unknown-host';

export interface SshError {
  kind: SshErrorKind;
  message: string;
}

// Ordered most-specific first. ControlMaster/multiplexing errors are checked
// before the generic connection errors because they silently break command
// execution over an otherwise-"working" session (mirrors Warp's dedicated
// ControlMaster-error event).
const SSH_ERROR_PATTERNS: ReadonlyArray<{ kind: SshErrorKind; re: RegExp; message: string }> = [
  {
    kind: 'control-master',
    re: /mux_client_request_session|muxserver_listen|ControlSocket .* already exists|Control socket connect\(|multiplexing|mux_client_/i,
    message: 'SSH multiplexing (ControlMaster) error — the shared connection is stale. Try `ssh -O exit <host>` or remove the stale control socket, then reconnect.',
  },
  {
    kind: 'host-key',
    re: /Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED|known_hosts/i,
    message: 'SSH host-key verification failed. Update ~/.ssh/known_hosts for this host before reconnecting.',
  },
  {
    kind: 'auth-failed',
    re: /Permission denied \(|Too many authentication failures|no matching .* found|Authentication failed/i,
    message: 'SSH authentication failed. Check your key/agent or credentials for this host.',
  },
  {
    kind: 'unknown-host',
    re: /Could not resolve hostname|Name or service not known|nodename nor servname/i,
    message: 'SSH could not resolve the hostname. Check the host name or your DNS.',
  },
  {
    kind: 'connection-refused',
    re: /Connection refused|Connection closed by remote host|ssh_exchange_identification|kex_exchange_identification/i,
    message: 'SSH connection refused/closed by the remote host. Confirm the SSH service is up and reachable.',
  },
  {
    kind: 'timeout',
    re: /Connection timed out|Operation timed out|timed out/i,
    message: 'SSH connection timed out. The host may be unreachable or behind a firewall.',
  },
];

/**
 * Classifies SSH error output (typically stderr or block output) into a known
 * failure category with a user-facing hint. Returns null when no SSH error is
 * recognized.
 */
export function detectSshError(text: string): SshError | null {
  if (!text) return null;
  for (const { kind, re, message } of SSH_ERROR_PATTERNS) {
    if (re.test(text)) return { kind, message };
  }
  return null;
}
