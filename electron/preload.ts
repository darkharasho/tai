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
  },
});
