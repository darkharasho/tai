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
        onData: (callback: (id: number, data: string) => void) => () => void;
      };
      window: {
        minimize: () => void;
        maximize: () => void;
        close: () => void;
      };
      ai: {
        send: (key: string, cwd: string, message: string, permMode: string, model: string) => Promise<boolean>;
        cancel: (key: string) => void;
        stop: (key: string) => void;
        approve: (key: string, toolUseId: string, approved: boolean) => Promise<boolean>;
        onMessage: (key: string, callback: (msg: any) => void) => () => void;
        onError: (key: string, callback: (error: string) => void) => () => void;
      };
      config: {
        get: () => Promise<Record<string, any>>;
        set: (key: string, value: any) => Promise<Record<string, any>>;
        onChanged: (callback: (config: any) => void) => () => void;
      };
    };
  }
}

export {};
