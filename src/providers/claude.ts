import type { Provider, ProviderCapabilities } from './types';

export function createClaudeProvider(tabId: string): Provider {
  let messageCleanup: (() => void) | null = null;

  return {
    id: 'claude',
    name: 'Claude',

    send(message: string, cwd: string, trustLevel: string, model?: string) {
      window.tai.ai.send(tabId, cwd, message, trustLevel, model || 'sonnet');
    },

    cancel() {
      window.tai.ai.cancel(tabId);
    },

    stop() {
      window.tai.ai.stop(tabId);
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
