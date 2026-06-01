export type ContextMode = 'shell' | 'ai' | 'agent' | 'error';

export type TrustLevel = 'ask' | 'approve-edits' | 'bypass';

export type AIProvider = 'claude' | 'codex' | 'gemini';

export type BlockBodyMode = 'output' | 'interactive' | 'password';

export interface SegmentedBlock {
  id: string;
  command: string;
  output: string;
  rawOutput: string;
  promptText: string;
  startTime: number;
  duration: number;
  isRemote: boolean;
  exitCode?: number;
  signal?: string | null;       // e.g. "SIG15"; null when exit was clean
  cwd?: string;                 // post-exec cwd from precmd hook
  commandFromShell?: string;    // command as shell saw it (post-alias)
  hooksAvailable?: boolean;     // true iff this block had an OSC 6973 precmd
}

export interface AIEntry {
  kind: 'text' | 'tool';
  text?: string;
  call?: AIToolCall;
}

export interface AIToolCall {
  id: string;
  name: string;
  input: string;
  output?: string;
  error?: string;
}

export type DisplayItem =
  | { type: 'command'; block: SegmentedBlock; collapsed: boolean; active: boolean; aiSuggested: boolean }
  | { type: 'ai'; id: string; question: string; entries: AIEntry[]; content: string; streaming: boolean }
  | { type: 'agent'; id: string; question: string; steps: AgentStep[]; streaming: boolean }
  | { type: 'approval'; id: string; command: string; status: 'pending' | 'approved' | 'rejected' | 'edited' }
  | { type: 'error-affordance'; id: string; block: SegmentedBlock };

export interface AgentStep {
  description: string;
  status: 'pending' | 'running' | 'complete' | 'failed';
  output?: string;
}

export interface TabState {
  id: string;
  ptyId: number | null;
  label: string;
  cwd: string;
  contextMode: ContextMode;
  trustLevel: TrustLevel;
  isRemote: boolean;
  sshTarget: string | null;
  remoteExecMode: 'auto' | 'local';
  aiProvider: AIProvider;
  aiWorking?: boolean;
}
