export interface StreamChunk {
  type: 'text' | 'tool_use' | 'tool_result' | 'done' | 'error' | 'approval_needed';
  content?: any;
  text?: string;
  toolCall?: { id: string; name: string; input: string };
  toolResult?: { id: string; output: string; error?: string };
}

export interface ProviderCapabilities {
  streaming: boolean;
  toolUse: boolean;
  fileEdit: boolean;
  commandExecution: boolean;
}

export interface Provider {
  id: string;
  name: string;
  send(message: string, cwd: string, trustLevel: string, model?: string, effort?: string): void;
  cancel(): void;
  stop(): void;
  onMessage(callback: (chunk: any) => void): () => void;
  getCapabilities(): ProviderCapabilities;
}
