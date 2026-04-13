import { stripAnsi } from '@/utils/stripAnsi';
import type { SegmentedBlock } from '@/types';

const PROMPT_RE = /(\S+[@:]\S+[\$#%>❯]|[\$#%❯])\s*$/;
const SSH_TARGET_RE = /(\S+)@(\S+?)[\s:]/;
const ALT_SCREEN_ENTER = '\x1b[?1049h';
const ALT_SCREEN_EXIT = '\x1b[?1049l';

type BlockCallback = (block: SegmentedBlock) => void;
type OutputCallback = (output: string, rawOutput: string) => void;
type AltScreenCallback = (entered: boolean) => void;
type PromptChangeCallback = (prompt: string, isRemote: boolean, sshTarget: string | null) => void;

export class BlockSegmenter {
  private _idCounter = 0;
  private _currentPrompt = '';
  private _initialPrompt = '';
  private _startTime = 0;
  private _pendingLines: string[] = [];
  private _pendingRawLines: string[] = [];
  private _partialLine = '';
  private _partialRawLine = '';
  private _blockCallbacks: BlockCallback[] = [];
  private _outputCallbacks: OutputCallback[] = [];
  private _altScreenCallbacks: AltScreenCallback[] = [];
  private _promptChangeCallbacks: PromptChangeCallback[] = [];
  private _seenFirstPrompt = false;
  private _inAltScreen = false;

  private _nextId(): string {
    return `seg-block-${++this._idCounter}`;
  }

  onBlock(cb: BlockCallback): void { this._blockCallbacks.push(cb); }
  onOutput(cb: OutputCallback): void { this._outputCallbacks.push(cb); }
  onAltScreen(cb: AltScreenCallback): void { this._altScreenCallbacks.push(cb); }
  onPromptChange(cb: PromptChangeCallback): void { this._promptChangeCallbacks.push(cb); }

  get currentPrompt(): string { return this._currentPrompt; }
  get seenFirstPrompt(): boolean { return this._seenFirstPrompt; }

  bootstrapPrompt(): void {
    if (!this._seenFirstPrompt) {
      this._seenFirstPrompt = true;
      this._startTime = Date.now();
    }
  }

  feed(rawData: string): void {
    if (rawData.includes(ALT_SCREEN_ENTER)) {
      this._inAltScreen = true;
      this._altScreenCallbacks.forEach(cb => cb(true));
    }
    if (rawData.includes(ALT_SCREEN_EXIT)) {
      this._inAltScreen = false;
      this._altScreenCallbacks.forEach(cb => cb(false));
    }

    if (this._inAltScreen) return;

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
        this._pendingLines.push(newCompleteLines[i]);
        this._pendingRawLines.push(newRawCompleteLines[i] ?? newCompleteLines[i]);
      }
    }

    this._checkForPrompt();

    if (this._seenFirstPrompt && this._pendingLines.length >= 1) {
      const outputLines = this._pendingLines.slice(1);
      const rawOutputLines = this._pendingRawLines.slice(1);
      const partialSuffix = this._partialLine ? '\n' + this._partialLine : '';
      const rawPartialSuffix = this._partialRawLine ? '\n' + this._partialRawLine : '';
      const output = outputLines.map(l => l.trimEnd()).join('\n').trim() + partialSuffix;
      const rawOutput = rawOutputLines.join('\n').trim() + rawPartialSuffix;
      if (output) {
        this._outputCallbacks.forEach(cb => cb(output, rawOutput));
      }
    }
  }

  private _checkForPrompt(): void {
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

  private _finalizeBlock(newPromptText: string): void {
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
        const promptMatch = firstLine.match(/^(?:\S+[@:]\S+[\$#%>❯]|[\$#%❯])\s*/);
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
      isRemote: this._isRemotePrompt(newPromptText),
    };

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
    const initId = this._extractIdentity(this._initialPrompt);
    const newId = this._extractIdentity(prompt);
    return this._initialPrompt !== '' && (
      (initId !== null && newId !== null && newId !== initId) ||
      (initId === null && newId !== null && prompt !== this._initialPrompt)
    );
  }

  private _firePromptChange(prompt: string): void {
    const isRemote = this._isRemotePrompt(prompt);
    const currentId = this._extractIdentity(prompt);
    const sshTarget = isRemote && currentId ? currentId : null;
    this._promptChangeCallbacks.forEach(cb => cb(prompt, isRemote, sshTarget));
  }

  reset(): void {
    this._currentPrompt = '';
    this._initialPrompt = '';
    this._startTime = 0;
    this._pendingLines = [];
    this._pendingRawLines = [];
    this._partialLine = '';
    this._partialRawLine = '';
    this._seenFirstPrompt = false;
    this._inAltScreen = false;
    this._blockCallbacks = [];
    this._outputCallbacks = [];
    this._altScreenCallbacks = [];
    this._promptChangeCallbacks = [];
  }
}
