import { stripAnsi, normalizeCursorRedraws } from '@/utils/stripAnsi';
import { parseOsc6973 } from '@/utils/osc6973';
import { parseInteractiveSshCommand, checkSshLoginState } from '@/utils/sshDetect';
import type { SegmentedBlock } from '@/types';

// Prompt-final glyphs. Beyond the classic `$#%>` we include theme glyphs
// (❯ → ➜ λ » ⟫) used by Starship/p10k/fish. Deliberately excludes box-drawing
// `│` and `▶`, which appear in TUI/table output and would cause false prompts.
const PROMPT_RE = /(\S+[@:]\S+.*[\$#%>❯→➜λ»⟫]|[→➜]\s+\S+|[\$#%>❯→➜λ»⟫])\s*$/;
const SSH_TARGET_RE = /(\S+)@(\S+?)[\s:]/;
const ALT_SCREEN_ENTER_SEQS = ['\x1b[?1049h', '\x1b[?47h', '\x1b[?1047h'];
const ALT_SCREEN_EXIT_SEQS = ['\x1b[?1049l', '\x1b[?47l', '\x1b[?1047l'];
const CURSOR_HIDE = '\x1b[?25l';
const CURSOR_SHOW = '\x1b[?25h';
const CURSOR_HOME = '\x1b[H';
const CLEAR_SCREEN = '\x1b[2J';
// Cursor-reposition escapes that signal an interactive program doing per-
// keystroke redraws:
//   ESC [ <n> A         CUU  (cursor up)
//   ESC [ <n> F         CPL  (cursor previous line)
//     — Ink-style TUIs (claude) redrawing frames on the main buffer.
//   ESC [ <n>D where n>=2  — REPLs (python pyrepl, node) doing per-char
//     prompt redraws via cursor-back. n=1 is plain backspace and stays
//     out of the trigger so legitimate single-char edits don't flip us.
// Any of these during an active block's output phase tells us the program
// owns its line-editing — route through xterm so the user sees keystroke
// echo and gets working history/arrow keys.
const TUI_REPOSITION_RE = /\x1b\[(?:\d*[AF]|(?:[2-9]|\d{2,})D)/;

/**
 * Apply carriage-return semantics: for each line, simulate \r by
 * keeping only text after the last bare \r (not \r\n which is just
 * a line ending).  If \r is the very last character (cursor parked
 * at column 0 waiting for the next overwrite), keep the previous
 * segment so the line isn't blank.
 */
function applyCR(str: string): string {
  if (!str.includes('\r')) return str;
  // Strip \r\n → \n first so only bare \r remain
  const normalized = str.replace(/\r\n/g, '\n');
  if (!normalized.includes('\r')) return normalized;
  return normalized.split('\n').map(line => {
    if (!line.includes('\r')) return line;
    // Split by \r and pick the last non-empty segment
    const segments = line.split('\r');
    for (let i = segments.length - 1; i >= 0; i--) {
      if (segments[i].length > 0) return segments[i];
    }
    return '';
  }).join('\n');
}

type BlockCallback = (block: SegmentedBlock) => void;
type OutputCallback = (output: string, rawOutput: string) => void;
type AltScreenCallback = (entered: boolean) => void;
type InteractiveModeCallback = (entered: boolean, fullscreen?: boolean) => void;
type PasswordPromptCallback = () => void;
type PromptChangeCallback = (prompt: string, isRemote: boolean, sshTarget: string | null) => void;
type ShellIntegrationCallback = (active: boolean) => void;
type SshSessionCallback = (active: boolean, target: string | null) => void;
type BlockActiveCallback = (active: boolean) => void;

// OSC 133 markers: ESC ] 133 ; <X>[;...] (BEL | ESC \)
// We only care about the trailing payload for the D marker (exit code).
const OSC133_RE = /\x1b\]133;([ABCD])([^\x07\x1b]*)?(?:\x07|\x1b\\)/g;
const OSC6973_RE = /\x1b\]6973;([^\x07\x1b]*)(?:\x07|\x1b\\)/g;

export class BlockSegmenter {
  private _idCounter = 0;
  private _currentPrompt = '';
  private _initialPrompt = '';
  private _localHostname = '';
  private _sshConnectionTarget: string | null = null;
  private _startTime = 0;
  private _pendingLines: string[] = [];
  private _pendingRawLines: string[] = [];
  private _partialLine = '';
  private _partialRawLine = '';
  private _blockCallbacks: BlockCallback[] = [];
  private _outputCallbacks: OutputCallback[] = [];
  private _altScreenCallbacks: AltScreenCallback[] = [];
  private _interactiveCallbacks: InteractiveModeCallback[] = [];
  private _passwordCallbacks: PasswordPromptCallback[] = [];
  private _promptChangeCallbacks: PromptChangeCallback[] = [];
  private _integrationCallbacks: ShellIntegrationCallback[] = [];
  private _sshSessionCallbacks: SshSessionCallback[] = [];
  private _blockActiveCallbacks: BlockActiveCallback[] = [];
  private _inSshSession = false;
  private _seenFirstPrompt = false;
  private _inAltScreen = false;
  // Carry the trailing bytes of each chunk so alt-screen sequences split
  // across chunk boundaries (e.g. "\x1b[?" | "1049h") are still detected.
  // Max-needed lookback = max(altSeq.length) - 1 = 7.
  private _altScreenTail = '';
  private _inInteractiveMode = false;
  private _interactiveFullscreen = false;
  private _commandActive = false;
  private _passwordPromptFired = false;

  // OSC 133 (shell integration) state. When `_integrationActive` is true, the
  // regex-based prompt heuristic is bypassed and segmentation is driven entirely
  // by markers emitted by the shell.
  private _integrationActive = false;
  private _osc133Phase: 'idle' | 'prompt' | 'command' | 'output' = 'idle';
  // Buffers store raw bytes; ANSI is stripped at finalization boundaries (B,
  // block finalize) so we never observe a partial CSI sequence mid-chunk.
  private _osc133RawPrompt = '';
  private _osc133RawCommand = '';
  private _osc133RawOutput = '';
  // Per-chunk-stripped clean output, accumulated alongside the raw buffer so
  // streaming onOutput callbacks don't re-strip the whole buffer each tick
  // (was O(N²) on chunky long-running commands like `find /`).
  private _osc133CleanOutput = '';
  private _osc133ExitCode: number | null = null;
  private _osc133BlockStart = 0;

  // OSC 6973 (shell hook) pending state — populated by preexec/precmd payloads
  // and consumed when finalizing the integrated block.
  private _pendingPreexec: { command: string } | null = null;
  private _pendingPrecmd: {
    exit: number;
    signal: string | null;
    duration_ms: number;
    command: string;
    cwd: string;
  } | null = null;

  private _nextId(): string {
    return `seg-block-${++this._idCounter}`;
  }

  onBlock(cb: BlockCallback): void { this._blockCallbacks.push(cb); }
  onOutput(cb: OutputCallback): void { this._outputCallbacks.push(cb); }
  onAltScreen(cb: AltScreenCallback): void { this._altScreenCallbacks.push(cb); }
  onInteractiveMode(cb: InteractiveModeCallback): void { this._interactiveCallbacks.push(cb); }
  onPasswordPrompt(cb: PasswordPromptCallback): void { this._passwordCallbacks.push(cb); }
  onPromptChange(cb: PromptChangeCallback): void { this._promptChangeCallbacks.push(cb); }
  onShellIntegration(cb: ShellIntegrationCallback): void { this._integrationCallbacks.push(cb); }
  onSshSession(cb: SshSessionCallback): void { this._sshSessionCallbacks.push(cb); }
  onBlockActive(cb: BlockActiveCallback): void { this._blockActiveCallbacks.push(cb); }

  private _setCommandActive(active: boolean): void {
    if (this._commandActive === active) return;
    this._commandActive = active;
    this._blockActiveCallbacks.forEach(cb => cb(active));
  }

  get currentPrompt(): string { return this._currentPrompt; }
  get pendingCommand(): string {
    return this._pendingPreexec?.command ?? '';
  }
  get seenFirstPrompt(): boolean { return this._seenFirstPrompt; }
  get shellIntegrationActive(): boolean { return this._integrationActive; }
  get sshSessionActive(): boolean { return this._inSshSession; }

  markCommandSent(): void {
    this._setCommandActive(true);
  }

  setLocalHostname(hostname: string): void {
    this._localHostname = hostname.toLowerCase();
    if (this._currentPrompt) {
      this._firePromptChange(this._currentPrompt);
    }
  }

  bootstrapPrompt(): void {
    if (!this._seenFirstPrompt) {
      this._seenFirstPrompt = true;
      this._startTime = Date.now();
    }
  }

  feed(rawData: string): void {
    if (rawData.includes('\x1b]6973;')) {
      rawData = this._consumeOsc6973(rawData);
      if (!rawData) return;
    }
    if (rawData.includes('\x1b]133;')) {
      rawData = this._consumeOsc133(rawData);
      if (!rawData) return;
    }
    if (this._integrationActive) {
      this._feedIntegrated(rawData);
      return;
    }
    this._feedLegacy(rawData);
  }

  private _feedLegacy(rawData: string): void {
    const scanned = this._altScreenTail + rawData;
    const hasAltEnter = ALT_SCREEN_ENTER_SEQS.some(s => scanned.includes(s));
    const altExitSeq = ALT_SCREEN_EXIT_SEQS.find(s => scanned.includes(s));
    this._altScreenTail = rawData.slice(-7);

    if (hasAltEnter) {
      this._inAltScreen = true;
      if (this._inInteractiveMode) {
        this._inInteractiveMode = false;
        this._interactiveFullscreen = false;
        this._interactiveCallbacks.forEach(cb => cb(false));
      }
      this._altScreenCallbacks.forEach(cb => cb(true));
    }
    if (altExitSeq) {
      this._inAltScreen = false;
      this._partialLine = '';
      this._partialRawLine = '';
      this._pendingLines = [];
      this._pendingRawLines = [];
      this._altScreenCallbacks.forEach(cb => cb(false));
      const exitIdx = rawData.indexOf(altExitSeq) + altExitSeq.length;
      rawData = rawData.substring(exitIdx);
      if (!rawData) return;
    }

    if (this._inAltScreen) return;

    if (rawData.includes(CURSOR_SHOW)) {
      if (this._inInteractiveMode) {
        this._inInteractiveMode = false;
        this._interactiveFullscreen = false;
        if (this._pendingLines.length > 1) {
          this._pendingLines = [this._pendingLines[0]];
          this._pendingRawLines = [this._pendingRawLines[0]];
        }
        this._partialLine = '';
        this._partialRawLine = '';
        this._interactiveCallbacks.forEach(cb => cb(false));
        const showIdx = rawData.indexOf(CURSOR_SHOW) + CURSOR_SHOW.length;
        rawData = rawData.substring(showIdx);
        if (!rawData) return;
      }
    }

    if (!this._inInteractiveMode && rawData.includes(CURSOR_HIDE) && this._seenFirstPrompt) {
      this._inInteractiveMode = true;
      this._interactiveFullscreen = true;
      if (this._pendingLines.length > 1) {
        this._pendingLines = [this._pendingLines[0]];
        this._pendingRawLines = [this._pendingRawLines[0]];
      }
      this._partialLine = '';
      this._partialRawLine = '';
      this._interactiveCallbacks.forEach(cb => cb(true, true));
    }

    const clean = stripAnsi(rawData);
    const newlineIndex = clean.lastIndexOf('\n');
    const rawNewlineIndex = rawData.lastIndexOf('\n');

    if (newlineIndex === -1) {
      this._partialLine += clean;
      this._partialRawLine += rawData;
    } else {
      const completeChunk = clean.substring(0, newlineIndex);
      const remainder = clean.substring(newlineIndex + 1);
      const newCompleteLines = (this._partialLine + completeChunk).split('\n');
      this._partialLine = remainder;

      const rawCompleteChunk = rawData.substring(0, rawNewlineIndex);
      const rawRemainder = rawData.substring(rawNewlineIndex + 1);
      const newRawCompleteLines = (this._partialRawLine + rawCompleteChunk).split('\n');
      this._partialRawLine = rawRemainder;

      for (let i = 0; i < newCompleteLines.length; i++) {
        let line = newCompleteLines[i];
        let rawLine = newRawCompleteLines[i] ?? line;
        // Handle \r (carriage return) in completed lines — keep only text after the last \r
        const cr = line.lastIndexOf('\r');
        if (cr !== -1) line = line.substring(cr + 1);
        const rawCr = rawLine.lastIndexOf('\r');
        if (rawCr !== -1) rawLine = rawLine.substring(rawCr + 1);
        this._pendingLines.push(line);
        this._pendingRawLines.push(rawLine);
      }
    }

    // Handle \r (carriage return) — keep only text after the last \r
    const crIdx = this._partialLine.lastIndexOf('\r');
    if (crIdx !== -1) {
      this._partialLine = this._partialLine.substring(crIdx + 1);
    }
    const rawCrIdx = this._partialRawLine.lastIndexOf('\r');
    if (rawCrIdx !== -1) {
      this._partialRawLine = this._partialRawLine.substring(rawCrIdx + 1);
    }

    if (!this._inInteractiveMode) this._checkForPrompt();

    if (this._seenFirstPrompt && this._pendingLines.length >= 1) {
      const outputLines = this._pendingLines.slice(1);
      const rawOutputLines = this._pendingRawLines.slice(1);
      const isPrompt = this._partialLine && PROMPT_RE.test(this._partialLine);
      const partialSuffix = this._partialLine && !isPrompt ? '\n' + this._partialLine : '';
      const rawPartialSuffix = this._partialRawLine && !isPrompt ? '\n' + this._partialRawLine : '';
      const output = outputLines.map(l => l.trimEnd()).join('\n').trim() + partialSuffix;
      const rawOutput = rawOutputLines.join('\n').trim() + rawPartialSuffix;
      if (output) {
        this._outputCallbacks.forEach(cb => cb(output, rawOutput));
      }
    }
  }

  private _checkForPrompt(): void {
    const pwRe = /(?:password|passphrase).*:\s*$/i;
    if (!this._passwordPromptFired) {
      if ((this._partialLine && pwRe.test(this._partialLine)) ||
          (this._pendingLines.length > 0 && pwRe.test(this._pendingLines[this._pendingLines.length - 1]))) {
        this._passwordPromptFired = true;
        this._passwordCallbacks.forEach(cb => cb());
      }
    }

    if (this._partialLine && PROMPT_RE.test(this._partialLine)) {
      this._handlePromptDetected(this._partialLine);
      return;
    }
    if (this._pendingLines.length > 0 && this._partialLine === '') {
      const lastLine = this._pendingLines[this._pendingLines.length - 1];
      if (PROMPT_RE.test(lastLine) && (!this._seenFirstPrompt || this._pendingLines.length > 1)) {
        this._pendingLines.pop();
        this._pendingRawLines.pop();
        this._handlePromptDetected(lastLine);
      }
    }
  }

  private _handlePromptDetected(promptText: string): void {
    if (this._pendingLines.length === 0 && !this._seenFirstPrompt) {
      this._seenFirstPrompt = true;
      this._currentPrompt = promptText;
      this._initialPrompt = promptText;
      this._startTime = Date.now();
      this._partialLine = '';
      this._partialRawLine = '';
      this._firePromptChange(promptText);
      return;
    }

    if (this._pendingLines.length === 0 && this._seenFirstPrompt) {
      this._exitInteractiveMode();
      const changed = promptText !== this._currentPrompt;
      this._currentPrompt = promptText;
      this._startTime = Date.now();
      this._partialLine = '';
      this._partialRawLine = '';
      if (changed) this._firePromptChange(promptText);
      return;
    }

    if (!this._seenFirstPrompt) {
      this._initialPrompt = promptText;
    }
    this._seenFirstPrompt = true;
    this._finalizeBlock(promptText);
  }

  private _exitInteractiveMode(): void {
    this._passwordPromptFired = false;
    if (this._inInteractiveMode) {
      this._inInteractiveMode = false;
      this._interactiveFullscreen = false;
      this._interactiveCallbacks.forEach(cb => cb(false));
    }
  }

  private _finalizeBlock(newPromptText: string): void {
    this._setCommandActive(false);
    this._exitInteractiveMode();
    const lines = this._pendingLines;
    const rawLines = this._pendingRawLines;
    let command = '';
    let outputLines: string[] = [];
    let rawOutputLines: string[] = [];

    if (lines.length > 0) {
      const firstLine = lines[0];
      const strippedPrompt = this._currentPrompt.trimEnd();
      if (strippedPrompt && firstLine.startsWith(strippedPrompt)) {
        command = firstLine.slice(strippedPrompt.length).trim();
      } else {
        const promptMatch = firstLine.match(/^(?:\S+[@:]\S+[\$#%>❯λ»⟫]|[\$#%❯λ»⟫])\s*/);
        if (promptMatch) {
          command = firstLine.slice(promptMatch[0].length).trim();
        } else {
          command = firstLine.trim();
        }
      }
      outputLines = lines.slice(1);
      rawOutputLines = rawLines.slice(1);
    }

    const output = outputLines.map(l => l.trimEnd()).join('\n').trim();
    const rawOutput = rawOutputLines.join('\n').trim();

    const block: SegmentedBlock = {
      id: this._nextId(),
      command,
      output,
      rawOutput,
      promptText: this._currentPrompt,
      startTime: this._startTime,
      duration: Date.now() - this._startTime,
      isRemote: this._isRemotePrompt(this._currentPrompt),
      hooksAvailable: false,
    };

    const ssh = parseInteractiveSshCommand(command);
    if (ssh && ssh.host) {
      this._sshConnectionTarget = ssh.host;
    }

    // Legacy (non-OSC 133) SSH-session detection. When an interactive ssh
    // command's output shows a login banner or a remote shell prompt, mark the
    // session active — this works even when the remote PS1 lacks `user@host`
    // and no OSC 133 markers arrive. Gated on the command parser so stray
    // output can't flip the flag. Clearing is best-effort: returning to the
    // original local prompt ends it (the OSC 133 path uses explicit D markers).
    if (ssh) {
      const loginState = checkSshLoginState(output);
      if (loginState === 'last-login' || loginState === 'prompt-detected') {
        this._setSshSession(true, ssh.host ?? this._sshConnectionTarget);
      }
    } else if (this._inSshSession && newPromptText === this._initialPrompt) {
      this._setSshSession(false, null);
    }

    this._blockCallbacks.forEach(cb => cb(block));

    this._currentPrompt = newPromptText;
    this._startTime = Date.now();
    this._pendingLines = [];
    this._pendingRawLines = [];
    this._partialLine = '';
    this._partialRawLine = '';
    this._firePromptChange(newPromptText);
  }

  private _extractIdentity(prompt: string): string | null {
    const m = prompt.match(SSH_TARGET_RE);
    return m ? `${m[1]}@${m[2]}` : null;
  }

  private _isRemotePrompt(prompt: string): boolean {
    const newId = this._extractIdentity(prompt);
    if (!newId) return false;

    const hostPart = newId.split('@')[1]?.toLowerCase() ?? '';
    if (hostPart === 'localhost' || hostPart === '127.0.0.1') return false;

    if (this._localHostname) {
      const localShort = this._localHostname.replace(/\.local(?:domain)?$/, '');
      const promptShort = hostPart.replace(/\.local(?:domain)?$/, '');
      return promptShort !== this._localHostname && promptShort !== localShort;
    }

    // Fallback when local hostname hasn't loaded: only flag remote if the
    // initial captured prompt had its own identity and the new identity
    // differs. The previous `initId === null` branch produced false positives
    // when the very first prompt happened to be a bootstrap/precmd prompt
    // without `user@host` — any later real prompt then got flagged remote,
    // causing the local session to be routed through ssh + askpass.
    const initId = this._extractIdentity(this._initialPrompt);
    return initId !== null && newId !== initId;
  }

  private _firePromptChange(prompt: string): void {
    const isRemote = this._isRemotePrompt(prompt);
    const sshTarget = isRemote
      ? (this._sshConnectionTarget ?? this._extractIdentity(prompt))
      : null;
    this._promptChangeCallbacks.forEach(cb => cb(prompt, isRemote, sshTarget));
  }

  private _consumeOsc6973(rawData: string): string {
    OSC6973_RE.lastIndex = 0;
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    const pieces: string[] = [];
    while ((match = OSC6973_RE.exec(rawData)) !== null) {
      pieces.push(rawData.slice(lastIndex, match.index));
      const parsed = parseOsc6973(match[1]);
      if (parsed) {
        if (parsed.hook === 'preexec') {
          this._pendingPreexec = { command: parsed.command };
        } else if (parsed.hook === 'precmd') {
          this._pendingPrecmd = {
            exit: parsed.exit,
            signal: parsed.signal,
            duration_ms: parsed.duration_ms,
            command: parsed.command,
            cwd: parsed.cwd,
          };
        }
      }
      lastIndex = OSC6973_RE.lastIndex;
    }
    if (lastIndex === 0) return rawData;
    pieces.push(rawData.slice(lastIndex));
    return pieces.join('');
  }

  private _consumeOsc133(rawData: string): string {
    OSC133_RE.lastIndex = 0;
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = OSC133_RE.exec(rawData)) !== null) {
      const before = rawData.slice(lastIndex, match.index);
      if (before) this._routeChunk(before);
      this._handleOsc133Marker(match[1] as 'A' | 'B' | 'C' | 'D', match[2] || '');
      lastIndex = OSC133_RE.lastIndex;
    }
    if (lastIndex === 0) return rawData;
    const tail = rawData.slice(lastIndex);
    if (tail && this._integrationActive) {
      this._routeChunk(tail);
      // Empty return signals "tail already consumed via _routeChunk; nothing
      // for the legacy path to do."
      return '';
    }
    return tail;
  }

  private _handleOsc133Marker(kind: 'A' | 'B' | 'C' | 'D', payload: string): void {
    if (!this._integrationActive) {
      this._integrationActive = true;
      // Discard any partial state accumulated by the legacy regex path.
      this._pendingLines = [];
      this._pendingRawLines = [];
      this._partialLine = '';
      this._partialRawLine = '';
      this._integrationCallbacks.forEach(cb => cb(true));
    }

    switch (kind) {
      case 'A': {
        if (this._osc133Phase !== 'idle' && this._osc133Phase !== 'prompt') {
          this._finalizeIntegratedBlock();
        }
        // Reaching a new local prompt is unambiguous proof we're back at the
        // local shell, so clear any SSH-session flag that didn't get cleared
        // by a D (network drop, kill -9, user reload, etc).
        if (this._inSshSession) this._setSshSession(false, null);
        // Same reasoning for alt-screen: a fresh prompt means the foreground
        // program (claude, vim, etc.) has exited. Reset so the next command's
        // line-oriented output isn't dropped by _routeChunk's alt-screen guard.
        if (this._inAltScreen) {
          this._inAltScreen = false;
          this._altScreenCallbacks.forEach(cb => cb(false));
        }
        this._osc133Phase = 'prompt';
        this._osc133RawPrompt = '';
        this._osc133RawCommand = '';
        this._osc133RawOutput = '';
        this._osc133CleanOutput = '';
        this._osc133ExitCode = null;
        this._osc133BlockStart = Date.now();
        this._passwordPromptFired = false;
        break;
      }
      case 'B': {
        this._osc133Phase = 'command';
        const promptText = stripAnsi(this._osc133RawPrompt);
        if (promptText && promptText !== this._currentPrompt) {
          this._currentPrompt = promptText;
          if (!this._seenFirstPrompt) {
            this._initialPrompt = promptText;
            this._seenFirstPrompt = true;
          }
          this._firePromptChange(promptText);
        } else if (!this._seenFirstPrompt && promptText) {
          this._seenFirstPrompt = true;
          this._currentPrompt = promptText;
          this._initialPrompt = promptText;
          this._firePromptChange(promptText);
        }
        break;
      }
      case 'C': {
        // Only honor C when transitioning from the command line. Ptyxis/GNOME
        // Terminal's bash integration emits a stray C inside the prompt area
        // (non-spec, looks like an "end of prior output" sentinel); ignoring
        // it there prevents the prompt characters from leaking into outputBuf.
        if (this._osc133Phase !== 'command') break;
        this._osc133Phase = 'output';
        this._setCommandActive(true);
        const ssh = parseInteractiveSshCommand(stripAnsi(this._osc133RawCommand).trim());
        if (ssh) {
          this._setSshSession(true, ssh.host);
        }
        break;
      }
      case 'D': {
        // Payload format: ";<exit-code>".
        const m = payload.match(/^;(-?\d+)/);
        if (m) this._osc133ExitCode = parseInt(m[1], 10);
        // Stay in output phase until the next A — trailing newlines or
        // shell-emitted text before the next prompt belong to this block.
        this._setCommandActive(false);
        if (this._inSshSession) this._setSshSession(false, null);
        break;
      }
    }
  }

  private _setSshSession(active: boolean, target: string | null): void {
    if (this._inSshSession === active) return;
    this._inSshSession = active;
    this._sshSessionCallbacks.forEach(cb => cb(active, target));
  }

  private _routeChunk(chunk: string): void {
    if (!this._integrationActive) return;
    // While the foreground program owns the alt-screen (vim, less, claude, etc)
    // the byte stream is full-screen TUI noise that doesn't belong in the
    // block's output buffer. Drop it; xterm.js renders it for the user
    // separately.
    if (this._inAltScreen) return;
    switch (this._osc133Phase) {
      case 'prompt':
        this._osc133RawPrompt += chunk;
        break;
      case 'command':
        this._osc133RawCommand += chunk;
        break;
      case 'output': {
        // Rewrite cursor-redraw escapes (ESC[<n>D / ESC[G) to \r in BOTH
        // raw and clean buffers so applyCR can collapse readline / pyrepl
        // per-keystroke prompt redraws into a single visible line. The raw
        // buffer keeps all other ANSI intact for ansiToHtml downstream.
        const normalized = normalizeCursorRedraws(chunk);
        this._osc133RawOutput += normalized;
        this._osc133CleanOutput += stripAnsi(chunk);
        const cleanCR = applyCR(this._osc133CleanOutput);
        const rawCR = applyCR(this._osc133RawOutput);
        if (cleanCR.length > 0) {
          this._outputCallbacks.forEach(cb => cb(cleanCR, rawCR));
        }
        break;
      }
      case 'idle':
        break;
    }
  }

  private _feedIntegrated(rawData: string): void {
    // Alt-screen and password-prompt detection are still useful in integrated
    // mode (TUIs, sudo prompts) — they don't conflict with OSC 133.
    // Prepend tail from previous chunk so split sequences are detected.
    const scanned = this._altScreenTail + rawData;
    const hasAltEnter = ALT_SCREEN_ENTER_SEQS.some(s => scanned.includes(s));
    const altExitSeq = ALT_SCREEN_EXIT_SEQS.find(s => scanned.includes(s));
    if (hasAltEnter && !this._inAltScreen) {
      this._inAltScreen = true;
      this._altScreenCallbacks.forEach(cb => cb(true));
    }
    if (altExitSeq && this._inAltScreen) {
      this._inAltScreen = false;
      this._altScreenCallbacks.forEach(cb => cb(false));
    }
    // Keep the last 7 bytes (max-altSeq-length - 1) for next chunk's scan.
    this._altScreenTail = rawData.slice(-7);

    // Ink-style TUIs (claude, many Node CLIs) never enter alt-screen — they
    // redraw frames in place on the main buffer using cursor-up. Treat that
    // as a TUI signal and flip to interactive so the bytes route to xterm
    // instead of accumulating as garbled text in the line-oriented output.
    if (!this._inAltScreen && this._osc133Phase === 'output' && TUI_REPOSITION_RE.test(rawData)) {
      this._inAltScreen = true;
      this._altScreenCallbacks.forEach(cb => cb(true));
    }

    if (!this._passwordPromptFired && /(?:password|passphrase).*:\s*$/i.test(stripAnsi(rawData))) {
      this._passwordPromptFired = true;
      this._passwordCallbacks.forEach(cb => cb());
    }

    this._routeChunk(rawData);
  }

  private _finalizeIntegratedBlock(): void {
    let rawCommand = this._osc133RawCommand;
    let rawOutputBytes = this._osc133RawOutput;

    // Fallback for shell integrations that don't emit a C marker between the
    // typed-input echo and the command output (Ptyxis/GNOME Terminal uses
    // OSC 3008 instead, which we don't currently parse). Split the command
    // buffer at the first newline: the line the user typed is the command,
    // anything after is output.
    if (!rawOutputBytes && rawCommand) {
      const nl = rawCommand.match(/\r?\n/);
      if (nl && nl.index !== undefined) {
        rawOutputBytes = rawCommand.slice(nl.index + nl[0].length);
        rawCommand = rawCommand.slice(0, nl.index);
      }
    }

    const command = stripAnsi(rawCommand).trim();
    const output = applyCR(stripAnsi(rawOutputBytes)).trimEnd();
    const rawOutput = applyCR(normalizeCursorRedraws(rawOutputBytes)).trimEnd();
    const promptText = stripAnsi(this._osc133RawPrompt) || this._currentPrompt;

    // Skip empty bootstrap "blocks" (e.g. the synthetic prompt that fires
    // right after we source the integration script with no command run).
    if (!command && !output) {
      return;
    }

    const block: SegmentedBlock = {
      id: this._nextId(),
      command,
      output,
      rawOutput,
      promptText,
      startTime: this._osc133BlockStart || Date.now(),
      duration: this._pendingPrecmd
        ? this._pendingPrecmd.duration_ms
        : Date.now() - (this._osc133BlockStart || Date.now()),
      isRemote: this._isRemotePrompt(promptText),
      ...(this._osc133ExitCode !== null ? { exitCode: this._osc133ExitCode } : {}),
      hooksAvailable: !!this._pendingPrecmd,
      ...(this._pendingPrecmd ? {
        signal: this._pendingPrecmd.signal,
        cwd: this._pendingPrecmd.cwd,
        commandFromShell: this._pendingPrecmd.command,
      } : {}),
    };

    const ssh = parseInteractiveSshCommand(command);
    if (ssh && ssh.host) {
      this._sshConnectionTarget = ssh.host;
    }

    this._blockCallbacks.forEach(cb => cb(block));
    this._setCommandActive(false);
    this._pendingPreexec = null;
    this._pendingPrecmd = null;
  }

  reset(): void {
    this._currentPrompt = '';
    this._initialPrompt = '';
    this._localHostname = '';
    this._startTime = 0;
    this._pendingLines = [];
    this._pendingRawLines = [];
    this._partialLine = '';
    this._partialRawLine = '';
    this._sshConnectionTarget = null;
    this._seenFirstPrompt = false;
    this._inAltScreen = false;
    this._altScreenTail = '';
    this._inInteractiveMode = false;
    this._interactiveFullscreen = false;
    this._commandActive = false;
    this._passwordPromptFired = false;
    this._blockCallbacks = [];
    this._outputCallbacks = [];
    this._altScreenCallbacks = [];
    this._interactiveCallbacks = [];
    this._passwordCallbacks = [];
    this._promptChangeCallbacks = [];
    this._integrationCallbacks = [];
    this._sshSessionCallbacks = [];
    this._blockActiveCallbacks = [];
    this._inSshSession = false;
    this._integrationActive = false;
    this._osc133Phase = 'idle';
    this._osc133RawPrompt = '';
    this._osc133RawCommand = '';
    this._osc133RawOutput = '';
    this._osc133CleanOutput = '';
    this._osc133ExitCode = null;
    this._osc133BlockStart = 0;
    this._pendingPreexec = null;
    this._pendingPrecmd = null;
  }

  /**
   * Treat a PTY resize as an implicit line boundary: flush any partial
   * line out to pendingLines so subsequent bytes (re-tokenized by xterm.js
   * against the new geometry) don't get glued to pre-resize state.
   */
  onResize(_cols: number, _rows: number): void {
    if (this._partialLine.length > 0 || this._partialRawLine.length > 0) {
      this._pendingLines.push(this._partialLine);
      this._pendingRawLines.push(this._partialRawLine);
      this._partialLine = '';
      this._partialRawLine = '';
    }
  }
}
