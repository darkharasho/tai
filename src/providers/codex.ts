import type { Provider, ProviderCapabilities } from './types';
import type { TrustLevel } from '@/types';

const TRUST_TO_PERM: Record<TrustLevel, string> = {
  'ask': 'auto',
  'approve-edits': 'read-only',
  'bypass': 'full-access',
};

export function createCodexProvider(tabId: string): Provider {
  let messageCleanup: (() => void) | null = null;

  return {
    id: 'codex',
    name: 'Codex',

    send(message: string, cwd: string, trustLevel: string, model?: string) {
      const permMode = TRUST_TO_PERM[trustLevel as TrustLevel] || 'auto';
      window.tai.codex.send(tabId, cwd, message, permMode, model || '');
    },

    cancel() {
      window.tai.codex.stop(tabId);
    },

    stop() {
      window.tai.codex.stop(tabId);
    },

    onMessage(callback: (msg: any) => void): () => void {
      messageCleanup?.();
      const thisCleanup = window.tai.ai.onMessage(tabId, callback);
      messageCleanup = thisCleanup;
      return () => {
        thisCleanup();
        if (messageCleanup === thisCleanup) messageCleanup = null;
      };
    },

    getCapabilities(): ProviderCapabilities {
      return {
        streaming: true,
        toolUse: true,
        fileEdit: true,
        commandExecution: true,
      };
    },
  };
}
