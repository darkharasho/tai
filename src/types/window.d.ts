declare global {
  interface Window {
    tai: {
      pty: {
        create: (cwd: string) => Promise<number>;
        write: (id: number, data: string) => void;
        resize: (id: number, cols: number, rows: number) => void;
        kill: (id: number) => void;
        getProcess: (id: number) => Promise<string | null>;
        getCwd: (id: number) => Promise<string | null>;
        isAwaitingInput: (id: number) => Promise<boolean>;
        tabComplete: (text: string, cwd: string) => Promise<string[]>;
        getShellHistory: (count: number) => Promise<string[]>;
        getRemoteShellHistory: (target: string, count: number) => Promise<string[]>;
        onData: (callback: (id: number, data: string) => void) => () => void;
      };
      window: {
        minimize: () => void;
        maximize: () => void;
        close: () => void;
        onMaximizedChange: (callback: (maximized: boolean) => void) => () => void;
      };
      ai: {
        send: (key: string, cwd: string, message: string, permMode: string, model: string) => Promise<boolean>;
        cancel: (key: string) => void;
        stop: (key: string) => void;
        approve: (key: string, toolUseId: string, approved: boolean) => Promise<boolean>;
        onMessage: (key: string, callback: (msg: any) => void) => () => void;
        onError: (key: string, callback: (error: string) => void) => () => void;
        setRemoteTarget: (key: string, target: string | null, mode: string) => Promise<boolean>;
      };
      codex: {
        send: (key: string, cwd: string, message: string, permMode: string, model: string) => Promise<boolean>;
        stop: (key: string) => void;
        setSessionId: (key: string, sessionId: string | undefined) => void;
      };
      gemini: {
        send: (key: string, cwd: string, message: string, approvalMode: string, model: string) => Promise<boolean>;
        stop: (key: string) => void;
        approve: (key: string, toolUseId: string, approved: boolean) => Promise<boolean>;
        setSessionId: (key: string, sessionId: string | undefined) => void;
      };
      system: {
        getHostname: () => Promise<string>;
        platform: string;
      };
      config: {
        get: () => Promise<Record<string, any>>;
        set: (key: string, value: any) => Promise<Record<string, any>>;
        onChanged: (callback: (config: any) => void) => () => void;
      };
      update: {
        check: () => void;
        install: () => void;
        getVersion: () => Promise<string>;
        onStatus: (callback: (status: string) => void) => () => void;
        onAvailable: (callback: (info: any) => void) => () => void;
        onProgress: (callback: (progress: any) => void) => () => void;
        onDownloaded: (callback: (info: any) => void) => () => void;
        onError: (callback: (err: any) => void) => () => void;
      };
    };
  }
}

export {};
