import type { Provider, ProviderCapabilities } from './types';
import type { TrustLevel } from '@/types';

const TRUST_TO_APPROVAL: Record<TrustLevel, string> = {
  'ask': 'default',
  'approve-edits': 'auto_edit',
  'bypass': 'yolo',
};

export function createGeminiProvider(tabId: string): Provider {
  let messageCleanup: (() => void) | null = null;

  return {
    id: 'gemini',
    name: 'Gemini',

    send(message: string, cwd: string, trustLevel: string, model?: string) {
      const approvalMode = TRUST_TO_APPROVAL[trustLevel as TrustLevel] || 'default';
      window.tai.gemini.send(tabId, cwd, message, approvalMode, model || '');
    },

    cancel() {
      window.tai.gemini.stop(tabId);
    },

    stop() {
      window.tai.gemini.stop(tabId);
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
