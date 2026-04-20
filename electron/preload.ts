import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('tai', {
  pty: {
    create: (cwd: string) => ipcRenderer.invoke('pty:create', cwd),
    write: (id: number, data: string) => ipcRenderer.send('pty:write', id, data),
    resize: (id: number, cols: number, rows: number) => ipcRenderer.send('pty:resize', id, cols, rows),
    kill: (id: number) => ipcRenderer.send('pty:kill', id),
    getProcess: (id: number) => ipcRenderer.invoke('pty:getProcess', id),
    getCwd: (id: number) => ipcRenderer.invoke('pty:getCwd', id),
    isAwaitingInput: (id: number) => ipcRenderer.invoke('pty:isAwaitingInput', id),
    tabComplete: (text: string, cwd: string) => ipcRenderer.invoke('pty:tabComplete', text, cwd),
    getShellHistory: (count: number) => ipcRenderer.invoke('pty:getShellHistory', count),
    getRemoteShellHistory: (target: string, count: number) => ipcRenderer.invoke('pty:getRemoteShellHistory', target, count),
    onData: (callback: (id: number, data: string) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, id: number, data: string) => callback(id, data);
      ipcRenderer.on('pty:data', listener);
      return () => ipcRenderer.removeListener('pty:data', listener);
    },
  },
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
    onMaximizedChange: (callback: (maximized: boolean) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, maximized: boolean) => callback(maximized);
      ipcRenderer.on('window:maximized-change', listener);
      return () => ipcRenderer.removeListener('window:maximized-change', listener);
    },
  },
  ai: {
    send: (key: string, cwd: string, message: string, permMode: string, model: string, effort?: string) =>
      ipcRenderer.invoke('ai:send', key, cwd, message, permMode, model, effort),
    cancel: (key: string) => ipcRenderer.send('ai:cancel', key),
    stop: (key: string) => ipcRenderer.send('ai:stop', key),
    approve: (key: string, toolUseId: string, approved: boolean) =>
      ipcRenderer.invoke('ai:approve', key, toolUseId, approved),
    onMessage: (key: string, callback: (msg: any) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, msgKey: string, msg: any) => {
        if (msgKey === key) callback(msg);
      };
      ipcRenderer.on('ai:message', listener);
      return () => ipcRenderer.removeListener('ai:message', listener);
    },
    onError: (key: string, callback: (error: string) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, errKey: string, error: string) => {
        if (errKey === key) callback(error);
      };
      ipcRenderer.on('ai:error', listener);
      return () => ipcRenderer.removeListener('ai:error', listener);
    },
    setRemoteTarget: (key: string, target: string | null, mode: string) =>
      ipcRenderer.invoke('ai:setRemoteTarget', key, target, mode),
  },
  codex: {
    send: (key: string, cwd: string, message: string, permMode: string, model: string) =>
      ipcRenderer.invoke('codex:send', key, cwd, message, permMode, model),
    stop: (key: string) => ipcRenderer.send('codex:stop', key),
    setSessionId: (key: string, sessionId: string | undefined) =>
      ipcRenderer.send('codex:setSessionId', key, sessionId),
  },
  gemini: {
    send: (key: string, cwd: string, message: string, approvalMode: string, model: string) =>
      ipcRenderer.invoke('gemini:send', key, cwd, message, approvalMode, model),
    stop: (key: string) => ipcRenderer.send('gemini:stop', key),
    approve: (key: string, toolUseId: string, approved: boolean) =>
      ipcRenderer.invoke('gemini:approve', key, toolUseId, approved),
    setSessionId: (key: string, sessionId: string | undefined) =>
      ipcRenderer.send('gemini:setSessionId', key, sessionId),
  },
  system: {
    getHostname: () => ipcRenderer.invoke('system:hostname'),
    platform: process.platform,
  },
  daemon: {
    check: (target: string) => ipcRenderer.invoke('tai:daemon:check', target),
    install: (target: string) => ipcRenderer.invoke('tai:daemon:install', target),
  },
  config: {
    get: () => ipcRenderer.invoke('config:get'),
    set: (key: string, value: any) => ipcRenderer.invoke('config:set', key, value),
    onChanged: (callback: (config: any) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, config: any) => callback(config);
      ipcRenderer.on('config:changed', listener);
      return () => ipcRenderer.removeListener('config:changed', listener);
    },
  },
  update: {
    check: () => ipcRenderer.send('update:check'),
    install: () => ipcRenderer.send('update:install'),
    getVersion: () => ipcRenderer.invoke('update:getVersion'),
    onStatus: (callback: (status: string) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, status: string) => callback(status);
      ipcRenderer.on('update:status', listener);
      return () => ipcRenderer.removeListener('update:status', listener);
    },
    onAvailable: (callback: (info: any) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, info: any) => callback(info);
      ipcRenderer.on('update:available', listener);
      return () => ipcRenderer.removeListener('update:available', listener);
    },
    onProgress: (callback: (progress: any) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, progress: any) => callback(progress);
      ipcRenderer.on('update:progress', listener);
      return () => ipcRenderer.removeListener('update:progress', listener);
    },
    onDownloaded: (callback: (info: any) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, info: any) => callback(info);
      ipcRenderer.on('update:downloaded', listener);
      return () => ipcRenderer.removeListener('update:downloaded', listener);
    },
    onError: (callback: (err: any) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, err: any) => callback(err);
      ipcRenderer.on('update:error', listener);
      return () => ipcRenderer.removeListener('update:error', listener);
    },
  },
});
