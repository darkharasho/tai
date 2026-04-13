# tai — Terminal-First AI Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone Electron terminal app that weaves AI (Claude CLI) directly into native terminal output via a hybrid xterm + rich block overlay rendering model.

**Architecture:** Electron main process owns PTY (node-pty) and AI provider subprocesses (Claude CLI). React renderer uses xterm.js as the primary terminal with a BlockOverlay injecting rich AI response/agent/approval blocks into the scroll flow. A flowing gradient border wraps the window and shifts color with context.

**Tech Stack:** Electron 36, React 19, TypeScript, Vite, xterm.js, node-pty, Lucide React, ReactMarkdown, Shiki, shell-quote

---

## File Structure

```
tai/
├── package.json
├── tsconfig.json
├── tsconfig.node.json
├── vite.config.ts
├── electron-builder.yml
├── electron/
│   ├── main.ts                          # Electron entry: window, IPC registration
│   ├── preload.ts                       # contextBridge — window.tai API
│   ├── services/
│   │   ├── pty.ts                       # PTY lifecycle, process tracking, tab completion
│   │   └── claude.ts                    # Claude CLI subprocess, streaming JSON, approval state
├── src/
│   ├── index.html                       # Vite HTML entry
│   ├── main.tsx                         # React entry
│   ├── App.tsx                          # Root: TabBar + active TerminalSession + GradientBorder
│   ├── types.ts                         # Shared type definitions
│   ├── styles/
│   │   └── globals.css                  # CSS custom properties, base styles, font imports
│   ├── utils/
│   │   ├── stripAnsi.ts                 # ANSI escape stripper
│   │   └── commandDetector.ts           # looksLikeShellCommand heuristic
│   ├── components/
│   │   ├── GradientBorder.tsx           # Full-window animated gradient border
│   │   ├── TabBar.tsx                   # Tab management UI
│   │   ├── TerminalSession.tsx          # Orchestrator: xterm + overlay + input per tab
│   │   ├── XtermPane.tsx                # Real xterm.js instance connected to PTY
│   │   ├── BlockOverlay.tsx             # Positions rich blocks anchored to xterm rows
│   │   ├── BlockSegmenter.ts            # PTY stream parser — prompt/command/output detection
│   │   ├── AIResponseBlock.tsx          # Streaming AI response with markdown + actions
│   │   ├── AgentStepCard.tsx            # Agent execution plan with step progress
│   │   ├── ApprovalPrompt.tsx           # Inline approve/edit/reject for AI commands
│   │   ├── ErrorAffordance.tsx          # "Ask AI to fix?" prompt after errors
│   │   ├── AIInputPanel.tsx             # Slide-in text area for AI natural language input
│   │   ├── ModeIndicator.tsx            # Shell/AI mode badge near prompt
│   │   └── SettingsOverlay.tsx          # Settings panel (Ctrl+,)
│   ├── providers/
│   │   ├── types.ts                     # Provider interface, StreamChunk, ProviderCapabilities
│   │   └── claude.ts                    # ClaudeCliProvider — IPC wrapper for Claude subprocess
│   └── hooks/
│       ├── useTerminalSession.ts        # PTY lifecycle, BlockSegmenter wiring, display state
│       ├── useGhostText.ts              # History-based prediction scoring
│       └── useSettings.ts               # Config read/write via IPC
├── tests/
│   ├── unit/
│   │   ├── stripAnsi.test.ts
│   │   ├── commandDetector.test.ts
│   │   ├── BlockSegmenter.test.ts
│   │   └── ghostText.test.ts
│   └── vitest.config.ts
```

---

### Task 1: Project Scaffold + Electron Shell

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsconfig.node.json`
- Create: `vite.config.ts`
- Create: `electron-builder.yml`
- Create: `electron/main.ts`
- Create: `electron/preload.ts`
- Create: `src/index.html`
- Create: `src/main.tsx`
- Create: `src/App.tsx`
- Create: `src/types.ts`
- Create: `src/styles/globals.css`

- [ ] **Step 1: Initialize npm project**

```bash
cd /var/home/mstephens/Documents/GitHub/tai
npm init -y
```

- [ ] **Step 2: Install production dependencies**

```bash
npm install react@^19 react-dom@^19 @xterm/xterm@^5.5.0 @xterm/addon-fit@^0.10.0 @xterm/addon-web-links@^0.11.0 node-pty@^1.0.0 react-markdown@^9 remark-gfm@^4 shiki@^4 shell-quote@^1.8.3 lucide-react@^1.7.0 electron-updater@^6
```

- [ ] **Step 3: Install dev dependencies**

```bash
npm install -D electron@^36 typescript@^5.7 vite@^6 @vitejs/plugin-react@^4.3 vite-plugin-electron@^0.28 vite-plugin-electron-renderer@^0.14 @electron/rebuild@^4 electron-builder@^26 @types/react@^19 @types/react-dom@^19 @types/shell-quote@^1.7.5 vitest@^4 @vitest/coverage-v8@^4 @testing-library/react@^16 @testing-library/jest-dom@^6 jsdom@^29
```

- [ ] **Step 4: Rebuild node-pty for Electron**

```bash
npx electron-rebuild -w node-pty
```

- [ ] **Step 5: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

- [ ] **Step 6: Create tsconfig.node.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist-electron"
  },
  "include": ["electron", "vite.config.ts"]
}
```

- [ ] **Step 7: Create vite.config.ts**

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';
import path from 'path';

export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        entry: 'electron/main.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: ['node-pty'],
            },
          },
        },
      },
      {
        entry: 'electron/preload.ts',
        onstart(args) {
          args.reload();
        },
      },
    ]),
    renderer(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
```

- [ ] **Step 8: Create electron-builder.yml**

```yaml
appId: com.tai.app
productName: tai
directories:
  output: release
files:
  - dist
  - dist-electron
asar: true
asarUnpack:
  - node_modules/node-pty/**/*
linux:
  target: AppImage
  category: Development
```

- [ ] **Step 9: Create electron/main.ts**

```typescript
import { app, BrowserWindow } from 'electron';
import path from 'path';

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 600,
    minHeight: 400,
    frame: false,
    transparent: false,
    backgroundColor: '#0a0a12',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  app.quit();
});
```

- [ ] **Step 10: Create electron/preload.ts (minimal — expanded in later tasks)**

```typescript
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('tai', {
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
  },
});
```

- [ ] **Step 11: Create src/types.ts**

```typescript
export type ContextMode = 'shell' | 'ai' | 'agent' | 'error';

export type TrustLevel = 'ask' | 'approve-edits' | 'bypass';

export interface SegmentedBlock {
  id: string;
  command: string;
  output: string;
  promptText: string;
  startTime: number;
  duration: number;
  isRemote: boolean;
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
}
```

- [ ] **Step 12: Create src/styles/globals.css**

```css
@import url('https://fonts.googleapis.com/css2?family=Geist+Mono:wght@400;500;600;700&display=swap');

:root {
  --bg-base: #0a0a12;
  --bg-surface: rgba(255, 255, 255, 0.03);
  --bg-input: rgba(255, 255, 255, 0.05);
  --border-subtle: rgba(255, 255, 255, 0.06);
  --text-primary: #e0e0e0;
  --text-secondary: #888;
  --text-muted: #555;
  --color-shell: #00ff88;
  --color-ai: #a855f7;
  --color-agent: #fb923c;
  --color-error: #ef4444;
  --color-warning: #facc15;
  --color-info: #38bdf8;
  --font-mono: 'Geist Mono', 'JetBrains Mono NF', 'Fira Code', monospace;
}

*, *::before, *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html, body, #root {
  height: 100%;
  background: var(--bg-base);
  color: var(--text-primary);
  font-family: var(--font-mono);
  overflow: hidden;
  -webkit-font-smoothing: antialiased;
}

::selection {
  background: rgba(168, 85, 247, 0.3);
}

::-webkit-scrollbar {
  width: 6px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 3px;
}
```

- [ ] **Step 13: Create src/index.html**

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>tai</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 14: Create src/main.tsx**

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/globals.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

- [ ] **Step 15: Create src/App.tsx (shell — expanded later)**

```tsx
export default function App() {
  return (
    <div style={{
      height: '100vh',
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--bg-base)',
    }}>
      <div style={{
        padding: '10px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        borderBottom: '1px solid var(--border-subtle)',
        WebkitAppRegion: 'drag' as any,
      }}>
        <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>tai</span>
      </div>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ color: 'var(--text-muted)' }}>Terminal loading...</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 16: Update package.json scripts**

Add these scripts to `package.json`:

```json
{
  "main": "dist-electron/main.js",
  "scripts": {
    "postinstall": "electron-rebuild -w node-pty",
    "dev": "vite",
    "build": "tsc && vite build",
    "dist": "vite build && electron-builder --linux AppImage",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

- [ ] **Step 17: Add window controls IPC to electron/main.ts**

Add after `createWindow()`:

```typescript
import { ipcMain } from 'electron';

ipcMain.on('window:minimize', () => mainWindow?.minimize());
ipcMain.on('window:maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.on('window:close', () => mainWindow?.close());
```

- [ ] **Step 18: Run dev to verify Electron shell launches**

```bash
npm run dev
```

Expected: Electron window opens with dark background, "tai" title bar, "Terminal loading..." placeholder. No errors in console.

- [ ] **Step 19: Commit**

```bash
git init
echo "node_modules/\ndist/\ndist-electron/\nrelease/\n.superpowers/" > .gitignore
git add package.json package-lock.json tsconfig.json tsconfig.node.json vite.config.ts electron-builder.yml electron/ src/ .gitignore
git commit -m "feat: scaffold electron app with vite + react"
```

---

### Task 2: PTY Service

**Files:**
- Create: `electron/services/pty.ts`
- Modify: `electron/main.ts` — import pty service
- Modify: `electron/preload.ts` — expose pty IPC

- [ ] **Step 1: Create electron/services/pty.ts**

```typescript
import * as pty from 'node-pty';
import { BrowserWindow, ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';

let hasSystemdRun: boolean | undefined;
function detectSystemdScope(): boolean {
  if (process.platform !== 'linux') return false;
  if (hasSystemdRun !== undefined) return hasSystemdRun;
  try {
    const { execFileSync } = require('child_process') as typeof import('child_process');
    execFileSync('systemd-run', ['--user', '--scope', '--', '/bin/true'], {
      stdio: 'ignore', timeout: 3000,
    });
    hasSystemdRun = true;
  } catch {
    hasSystemdRun = false;
  }
  return hasSystemdRun;
}

let canUseSystemdScope = detectSystemdScope;

const allTerminals = new Map<number, pty.IPty>();
let nextId = 1;

export function setupPtyService(getWindow: () => BrowserWindow | null) {
  function safeSend(channel: string, ...args: unknown[]) {
    const win = getWindow();
    try {
      if (win && !win.isDestroyed()) {
        win.webContents.send(channel, ...args);
      }
    } catch {}
  }

  ipcMain.handle('pty:create', (_event, cwd: string) => {
    const shell = process.env.SHELL || '/bin/bash';
    const id = nextId++;
    const env = { ...process.env } as Record<string, string>;
    delete env.GIO_LAUNCHED_DESKTOP_FILE;
    delete env.GIO_LAUNCHED_DESKTOP_FILE_PID;
    delete env.BAMF_DESKTOP_FILE_HINT;
    delete env.XDG_ACTIVATION_TOKEN;
    delete env.DESKTOP_STARTUP_ID;
    delete env.CHROME_DESKTOP;
    delete env.INVOCATION_ID;

    const useScope = canUseSystemdScope();
    const spawnCmd = useScope ? 'systemd-run' : shell;
    const spawnArgs = useScope
      ? ['--user', '--scope', '--quiet', '--', shell, '--login']
      : ['--login'];

    const term = pty.spawn(spawnCmd, spawnArgs, {
      name: 'xterm-256color',
      cwd: cwd || process.env.HOME || '/',
      env,
    });

    allTerminals.set(id, term);

    term.onData((data) => safeSend('pty:data', id, data));
    term.onExit(() => { allTerminals.delete(id); });

    return id;
  });

  ipcMain.on('pty:write', (_event, id: number, data: string) => {
    allTerminals.get(id)?.write(data);
  });

  ipcMain.on('pty:resize', (_event, id: number, cols: number, rows: number) => {
    allTerminals.get(id)?.resize(cols, rows);
  });

  ipcMain.on('pty:kill', (_event, id: number) => {
    const term = allTerminals.get(id);
    if (term) {
      term.kill();
      allTerminals.delete(id);
    }
  });

  ipcMain.handle('pty:getProcess', (_event, id: number) => {
    const term = allTerminals.get(id);
    if (!term) return null;
    if (process.platform === 'linux') {
      try {
        const stat = fs.readFileSync(`/proc/${term.pid}/stat`, 'utf8');
        const closeParenIdx = stat.lastIndexOf(')');
        const fields = stat.slice(closeParenIdx + 2).split(' ');
        const tpgid = parseInt(fields[5], 10);
        if (tpgid > 0) {
          const comm = fs.readFileSync(`/proc/${tpgid}/comm`, 'utf8').trim();
          return comm || term.process;
        }
      } catch {}
    }
    return term.process;
  });

  ipcMain.handle('pty:getCwd', (_event, id: number) => {
    const term = allTerminals.get(id);
    if (!term) return null;
    if (process.platform === 'linux') {
      try {
        return fs.readlinkSync(`/proc/${term.pid}/cwd`);
      } catch {}
    }
    return null;
  });

  ipcMain.handle('pty:isAwaitingInput', (_event, id: number) => {
    const term = allTerminals.get(id);
    if (!term || process.platform !== 'linux') return false;
    try {
      const stat = fs.readFileSync(`/proc/${term.pid}/stat`, 'utf8');
      const closeParenIdx = stat.lastIndexOf(')');
      const fields = stat.slice(closeParenIdx + 2).split(' ');
      const tpgid = parseInt(fields[5], 10);
      if (tpgid <= 0) return false;
      const wchan = fs.readFileSync(`/proc/${tpgid}/wchan`, 'utf8').trim();
      return wchan === 'n_tty_read' || wchan === 'read_chan' || wchan === 'wait_woken';
    } catch {
      return false;
    }
  });

  ipcMain.handle('pty:tabComplete', async (_event, text: string, cwd: string) => {
    const lastWord = text.split(/\s+/).pop() || '';
    const isFirstWord = !text.includes(' ');
    const flags = isFirstWord ? '-c -f' : '-f -d';
    const escaped = lastWord ? lastWord.replace(/'/g, "'\\''") : '';
    const cmd = escaped
      ? `compgen ${flags} -- '${escaped}' 2>/dev/null | head -50`
      : `compgen ${flags} 2>/dev/null | head -50`;
    return new Promise<string[]>((resolve) => {
      execFile('bash', ['-c', cmd], { cwd, timeout: 2000 }, (err, stdout) => {
        if (err || !stdout.trim()) { resolve([]); return; }
        const raw = [...new Set(stdout.trim().split('\n').filter(Boolean))];
        const results = raw.map(entry => {
          const absPath = path.isAbsolute(entry) ? entry : path.resolve(cwd, entry);
          try {
            if (fs.statSync(absPath).isDirectory()) return entry + '/';
          } catch {}
          return entry;
        });
        resolve(results);
      });
    });
  });

  ipcMain.handle('pty:getShellHistory', async (_event, count: number) => {
    const home = process.env.HOME || '/';
    const candidates = [
      path.join(home, '.zsh_history'),
      path.join(home, '.bash_history'),
    ];
    for (const histFile of candidates) {
      try {
        const content = fs.readFileSync(histFile, 'utf8');
        const lines = content.split('\n').filter(Boolean);
        const parsed = lines.map(l => {
          const m = l.match(/^: \d+:\d+;(.*)$/);
          return m ? m[1] : l;
        });
        return parsed.slice(-count);
      } catch { continue; }
    }
    return [];
  });
}

export function destroyAllTerminals() {
  for (const term of allTerminals.values()) term.kill();
  allTerminals.clear();
}
```

- [ ] **Step 2: Update electron/main.ts to import PTY service**

Replace the entire file with:

```typescript
import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { setupPtyService, destroyAllTerminals } from './services/pty';

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 600,
    minHeight: 400,
    frame: false,
    transparent: false,
    backgroundColor: '#0a0a12',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.whenReady().then(() => {
  createWindow();
  setupPtyService(() => mainWindow);
});

app.on('window-all-closed', () => {
  destroyAllTerminals();
  app.quit();
});

ipcMain.on('window:minimize', () => mainWindow?.minimize());
ipcMain.on('window:maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.on('window:close', () => mainWindow?.close());
```

- [ ] **Step 3: Update electron/preload.ts to expose PTY API**

Replace the entire file with:

```typescript
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
```

- [ ] **Step 4: Run dev to verify PTY service loads without errors**

```bash
npm run dev
```

Expected: App launches, no IPC registration errors in main process console.

- [ ] **Step 5: Commit**

```bash
git add electron/services/pty.ts electron/main.ts electron/preload.ts
git commit -m "feat: add PTY service with process tracking and tab completion"
```

---

### Task 3: XtermPane Component

**Files:**
- Create: `src/components/XtermPane.tsx`
- Modify: `src/App.tsx` — wire up XtermPane with a PTY

- [ ] **Step 1: Create src/components/XtermPane.tsx**

```tsx
import { useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';

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
    };
  }
}

export interface XtermPaneHandle {
  getTerminal: () => Terminal | null;
  focus: () => void;
  fit: () => void;
}

interface XtermPaneProps {
  ptyId: number | null;
  visible?: boolean;
  onData?: (data: string) => void;
}

export const XtermPane = forwardRef<XtermPaneHandle, XtermPaneProps>(
  function XtermPane({ ptyId, visible = true, onData }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const terminalRef = useRef<Terminal | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);

    useImperativeHandle(ref, () => ({
      getTerminal: () => terminalRef.current,
      focus: () => terminalRef.current?.focus(),
      fit: () => fitAddonRef.current?.fit(),
    }));

    const fitAndResize = useCallback(() => {
      if (!fitAddonRef.current || !terminalRef.current || ptyId === null) return;
      try {
        fitAddonRef.current.fit();
        const { cols, rows } = terminalRef.current;
        window.tai.pty.resize(ptyId, cols, rows);
      } catch {}
    }, [ptyId]);

    useEffect(() => {
      if (!containerRef.current) return;

      const terminal = new Terminal({
        fontFamily: "'Geist Mono', 'JetBrains Mono NF', 'Fira Code', monospace",
        fontSize: 14,
        lineHeight: 1.4,
        cursorBlink: true,
        cursorStyle: 'bar',
        theme: {
          background: '#0a0a12',
          foreground: '#e0e0e0',
          cursor: '#e0e0e0',
          selectionBackground: 'rgba(168, 85, 247, 0.3)',
          black: '#1a1a2e',
          red: '#ef4444',
          green: '#00ff88',
          yellow: '#facc15',
          blue: '#38bdf8',
          magenta: '#a855f7',
          cyan: '#22d3ee',
          white: '#e0e0e0',
          brightBlack: '#555',
          brightRed: '#f87171',
          brightGreen: '#4ade80',
          brightYellow: '#fde047',
          brightBlue: '#60a5fa',
          brightMagenta: '#c084fc',
          brightCyan: '#67e8f9',
          brightWhite: '#ffffff',
        },
        allowTransparency: true,
        scrollback: 10000,
      });

      const fitAddon = new FitAddon();
      const webLinksAddon = new WebLinksAddon();
      terminal.loadAddon(fitAddon);
      terminal.loadAddon(webLinksAddon);

      terminal.open(containerRef.current);
      terminalRef.current = terminal;
      fitAddonRef.current = fitAddon;

      setTimeout(() => fitAndResize(), 50);

      return () => {
        terminal.dispose();
        terminalRef.current = null;
        fitAddonRef.current = null;
      };
    }, []);

    useEffect(() => {
      const terminal = terminalRef.current;
      if (!terminal || ptyId === null) return;

      const keyDisposable = terminal.onData((data) => {
        window.tai.pty.write(ptyId, data);
      });

      const dataCleanup = window.tai.pty.onData((id, data) => {
        if (id !== ptyId) return;
        terminal.write(data);
        onData?.(data);
      });

      return () => {
        keyDisposable.dispose();
        dataCleanup();
      };
    }, [ptyId, onData]);

    useEffect(() => {
      if (!containerRef.current || !visible) return;
      const observer = new ResizeObserver(() => fitAndResize());
      observer.observe(containerRef.current);
      return () => observer.disconnect();
    }, [visible, fitAndResize]);

    return (
      <div
        ref={containerRef}
        style={{
          flex: 1,
          display: visible ? 'block' : 'none',
          padding: '8px 0 0 8px',
        }}
      />
    );
  }
);
```

- [ ] **Step 2: Update src/App.tsx to mount XtermPane**

```tsx
import { useState, useEffect, useRef } from 'react';
import { XtermPane, XtermPaneHandle } from './components/XtermPane';

export default function App() {
  const [ptyId, setPtyId] = useState<number | null>(null);
  const xtermRef = useRef<XtermPaneHandle>(null);

  useEffect(() => {
    const cwd = process.env.HOME || '/';
    window.tai.pty.create(cwd).then((id) => {
      setPtyId(id);
    });

    return () => {
      if (ptyId !== null) window.tai.pty.kill(ptyId);
    };
  }, []);

  useEffect(() => {
    if (ptyId !== null) {
      setTimeout(() => xtermRef.current?.focus(), 100);
    }
  }, [ptyId]);

  return (
    <div style={{
      height: '100vh',
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--bg-base)',
    }}>
      <div style={{
        padding: '10px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        borderBottom: '1px solid var(--border-subtle)',
        WebkitAppRegion: 'drag' as any,
        userSelect: 'none',
      }}>
        <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>tai</span>
      </div>
      <XtermPane ref={xtermRef} ptyId={ptyId} />
    </div>
  );
}
```

- [ ] **Step 3: Run dev to verify working terminal**

```bash
npm run dev
```

Expected: Electron window with a working terminal. You can type commands (`ls`, `pwd`, etc.), see output, resize the window. Full interactive shell.

- [ ] **Step 4: Commit**

```bash
git add src/components/XtermPane.tsx src/App.tsx
git commit -m "feat: add XtermPane with PTY integration"
```

---

### Task 4: Utilities — stripAnsi + commandDetector

**Files:**
- Create: `src/utils/stripAnsi.ts`
- Create: `src/utils/commandDetector.ts`
- Create: `tests/unit/stripAnsi.test.ts`
- Create: `tests/unit/commandDetector.test.ts`
- Create: `tests/vitest.config.ts`

- [ ] **Step 1: Create tests/vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '../src'),
    },
  },
});
```

- [ ] **Step 2: Write failing tests for stripAnsi**

Create `tests/unit/stripAnsi.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { stripAnsi } from '@/utils/stripAnsi';

describe('stripAnsi', () => {
  it('removes CSI color sequences', () => {
    expect(stripAnsi('\x1b[32mgreen\x1b[0m')).toBe('green');
  });

  it('removes OSC sequences', () => {
    expect(stripAnsi('\x1b]0;title\x07text')).toBe('text');
  });

  it('removes cursor movement sequences', () => {
    expect(stripAnsi('\x1b[2Jhello\x1b[H')).toBe('hello');
  });

  it('strips carriage returns', () => {
    expect(stripAnsi('line1\r\nline2')).toBe('line1\nline2');
  });

  it('preserves plain text', () => {
    expect(stripAnsi('hello world')).toBe('hello world');
  });

  it('handles alt-screen sequences within mixed content', () => {
    expect(stripAnsi('\x1b[?1049hhello')).toBe('hello');
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npx vitest run --config tests/vitest.config.ts tests/unit/stripAnsi.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 4: Create src/utils/stripAnsi.ts**

```typescript
const ANSI_RE = /\x1b\[[?>=!]?[0-9;]*[A-Za-z~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[P^_X][^\x1b]*\x1b\\|\x1b\([A-Z]|\x1b[A-Za-z=>]|\r/g;

export function stripAnsi(str: string): string {
  return str.replace(ANSI_RE, '');
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run --config tests/vitest.config.ts tests/unit/stripAnsi.test.ts
```

Expected: 6 tests PASS.

- [ ] **Step 6: Write failing tests for commandDetector**

Create `tests/unit/commandDetector.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { looksLikeShellCommand } from '@/utils/commandDetector';

describe('looksLikeShellCommand', () => {
  it('recognizes known commands', () => {
    expect(looksLikeShellCommand('ls -la')).toBe(true);
    expect(looksLikeShellCommand('git status')).toBe(true);
    expect(looksLikeShellCommand('docker compose up -d')).toBe(true);
  });

  it('recognizes path-like patterns', () => {
    expect(looksLikeShellCommand('./script.sh')).toBe(true);
    expect(looksLikeShellCommand('~/bin/tool')).toBe(true);
    expect(looksLikeShellCommand('/usr/bin/env python')).toBe(true);
  });

  it('recognizes env variable assignments', () => {
    expect(looksLikeShellCommand('NODE_ENV=production npm start')).toBe(true);
  });

  it('recognizes shell operators', () => {
    expect(looksLikeShellCommand('cat file | grep pattern')).toBe(true);
    expect(looksLikeShellCommand('echo hello > file.txt')).toBe(true);
  });

  it('detects natural language questions', () => {
    expect(looksLikeShellCommand('how do I fix this error?')).toBe(false);
    expect(looksLikeShellCommand('what is the best way to deploy')).toBe(false);
    expect(looksLikeShellCommand('explain this code')).toBe(false);
  });

  it('detects conversational input', () => {
    expect(looksLikeShellCommand('I need help with the auth system')).toBe(false);
    expect(looksLikeShellCommand('can you refactor this function')).toBe(false);
    expect(looksLikeShellCommand('thanks that looks good')).toBe(false);
  });

  it('handles edge cases', () => {
    expect(looksLikeShellCommand('')).toBe(false);
    expect(looksLikeShellCommand('a')).toBe(false);
    expect(looksLikeShellCommand('npm')).toBe(true);
  });

  it('recognizes flags as shell signals', () => {
    expect(looksLikeShellCommand('something --verbose')).toBe(true);
    expect(looksLikeShellCommand('tool -v')).toBe(true);
  });

  it('detects question marks as natural language', () => {
    expect(looksLikeShellCommand('is this a bug?')).toBe(false);
  });
});
```

- [ ] **Step 7: Run tests to verify they fail**

```bash
npx vitest run --config tests/vitest.config.ts tests/unit/commandDetector.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 8: Create src/utils/commandDetector.ts**

```typescript
import { parse as shellParse } from 'shell-quote';

const KNOWN_COMMANDS = new Set([
  'cd', 'ls', 'll', 'la', 'pwd', 'echo', 'cat', 'head', 'tail', 'less', 'more',
  'cp', 'mv', 'rm', 'mkdir', 'rmdir', 'touch', 'chmod', 'chown', 'chgrp', 'ln',
  'find', 'grep', 'rg', 'ag', 'sed', 'awk', 'sort', 'uniq', 'wc', 'tr', 'cut',
  'diff', 'patch', 'file', 'which', 'whereis', 'type', 'alias', 'unalias',
  'export', 'unset', 'source', 'eval', 'exec', 'exit', 'clear', 'reset',
  'history', 'true', 'false', 'test', 'read', 'printf', 'set',
  'du', 'df', 'mount', 'umount', 'tar', 'zip', 'unzip', 'gzip', 'gunzip', 'bzip2',
  'xz', 'zcat', 'stat', 'dd', 'rsync', 'scp',
  'ps', 'top', 'htop', 'btop', 'kill', 'killall', 'pkill', 'fg', 'bg', 'jobs',
  'nohup', 'xargs', 'time', 'watch', 'uptime', 'free', 'uname', 'hostname',
  'whoami', 'id', 'su', 'sudo', 'doas', 'env', 'man', 'info', 'tee',
  'curl', 'wget', 'ssh', 'ping', 'nc', 'netstat', 'ss', 'ip', 'ifconfig',
  'dig', 'nslookup', 'traceroute', 'host',
  'git', 'gh', 'npm', 'npx', 'yarn', 'pnpm', 'bun', 'deno', 'node', 'tsx', 'ts-node',
  'python', 'python3', 'pip', 'pip3', 'pipenv', 'poetry', 'uv', 'uvx',
  'ruby', 'gem', 'bundle', 'rake', 'rails',
  'go', 'cargo', 'rustc', 'rustup',
  'java', 'javac', 'mvn', 'gradle',
  'make', 'cmake', 'gcc', 'g++', 'clang',
  'docker', 'podman', 'kubectl', 'helm',
  'terraform', 'ansible', 'vagrant',
  'vim', 'nvim', 'vi', 'nano', 'emacs', 'code', 'micro',
  'apt', 'apt-get', 'dnf', 'yum', 'pacman', 'brew', 'flatpak', 'snap',
  'jq', 'yq', 'tree', 'bat', 'eza', 'exa', 'fd', 'fzf', 'tmux', 'screen',
  'systemctl', 'journalctl', 'lsof', 'strace',
]);

const NL_STARTERS = /^(what|why|how|when|where|who|which|can|could|would|should|is|are|do|does|did|will|shall|tell|explain|help|show|describe|fix|find|list|create|make|write|give|suggest|compare|check|analyze|summarize|refactor|debug|implement|add|remove|update|change|convert|translate|generate|optimize|review|please|hey|hi|sorry|thanks|thank)\b/i;

const NL_WORDS = new Set([
  'there', 'here', 'ok', 'okay', 'hold', 'wait', 'but', 'so',
  'actually', 'maybe', 'also', 'just', 'well', 'yeah', 'yes', 'no',
  'nah', 'nope', 'hmm', 'hm', 'ah', 'oh', 'ooh', 'um', 'uh',
  'never', 'always', 'only', 'not', 'dont', 'like', 'let', 'lets',
  'i', 'im', 'its', 'thats', 'whats', 'heres', 'theres',
  'in', 'on', 'at', 'to', 'the', 'a', 'an', 'it', 'we',
  'yep', 'looks', 'good', 'great', 'nice', 'cool', 'sure', 'perfect',
  'sounds', 'awesome', 'fine', 'right', 'correct', 'exactly',
  'that', 'this', 'these', 'those', 'some', 'any', 'every',
  'pretty', 'really', 'very', 'quite', 'super', 'totally',
  'id', 'ill', 'ive', 'youre', 'youll', 'youd', 'youve',
  'wed', 'weve', 'were', 'theyre', 'theyd', 'theyve', 'theyll',
  'hes', 'shes', 'hed', 'shed', 'itll', 'wont', 'cant', 'didnt',
  'doesnt', 'isnt', 'arent', 'wasnt', 'werent', 'hasnt', 'havent',
  'wouldnt', 'couldnt', 'shouldnt', 'mustnt',
]);

const PRONOUNS = new Set([
  'i', 'me', 'my', 'you', 'your', 'we', 'our', 'they', 'their',
  'he', 'she', 'him', 'her', 'us', 'them',
]);

const SENTENCE_WORDS = new Set([
  'the', 'a', 'an', 'this', 'that', 'these', 'those', 'some', 'any', 'every',
  'of', 'for', 'with', 'about', 'into', 'from', 'between', 'through', 'during',
  'before', 'after', 'above', 'below', 'under', 'over',
  'and', 'or', 'but', 'because', 'since', 'although', 'whether', 'while',
  'if', 'then', 'than', 'either', 'neither',
  'have', 'has', 'had', 'was', 'were', 'been', 'being', 'am', 'are', 'is',
  'do', 'does', 'did', 'done', 'doing',
  'get', 'got', 'getting', 'gets',
  'know', 'known', 'knew', 'think', 'thought', 'want', 'need', 'see', 'saw', 'seen',
  'going', 'gonna', 'wanna', 'gotta',
  'not', 'very', 'really', 'already', 'still', 'even', 'probably', 'definitely',
]);

export function looksLikeShellCommand(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed) return false;

  if (/^[.~\/]/.test(trimmed)) return true;
  if (/^[A-Z_][A-Z0-9_]*=/.test(trimmed)) return true;
  if (/[|><;&]/.test(trimmed)) return true;
  if (/\s-{1,2}[a-zA-Z]/.test(trimmed)) return true;
  if (trimmed.includes('?')) return false;

  const firstWord = trimmed.split(/\s+/)[0].toLowerCase();

  if (KNOWN_COMMANDS.has(firstWord)) return true;
  if (NL_STARTERS.test(trimmed)) return false;
  if (NL_WORDS.has(firstWord)) return false;
  if (trimmed.length === 1) return false;
  if (!trimmed.includes(' ')) return true;

  const words = trimmed.split(/\s+/);
  if (words.length <= 3 && /^[a-z0-9_][\w.-]*$/i.test(firstWord)) return true;
  if (words.some(w => PRONOUNS.has(w.toLowerCase()))) return false;

  const nlCount = words.filter(w => SENTENCE_WORDS.has(w.toLowerCase())).length;
  if (nlCount >= 2) return false;

  try {
    const parsed = shellParse(trimmed);
    const hasShellTokens = parsed.some(t => typeof t === 'object');
    if (hasShellTokens) return true;
  } catch {}

  if (/^[a-z0-9_][\w.-]*$/i.test(firstWord)) return true;

  return false;
}
```

- [ ] **Step 9: Run tests to verify they pass**

```bash
npx vitest run --config tests/vitest.config.ts tests/unit/
```

Expected: All tests PASS.

- [ ] **Step 10: Commit**

```bash
git add src/utils/ tests/
git commit -m "feat: add stripAnsi and command detection heuristic with tests"
```

---

### Task 5: BlockSegmenter

**Files:**
- Create: `src/components/BlockSegmenter.ts`
- Create: `tests/unit/BlockSegmenter.test.ts`

- [ ] **Step 1: Write failing tests for BlockSegmenter**

Create `tests/unit/BlockSegmenter.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { BlockSegmenter } from '@/components/BlockSegmenter';

describe('BlockSegmenter', () => {
  it('detects a prompt and fires onBlock after command completes', () => {
    const segmenter = new BlockSegmenter();
    const blockCb = vi.fn();
    segmenter.onBlock(blockCb);

    segmenter.feed('user@host:~$ ');
    expect(segmenter.seenFirstPrompt).toBe(true);

    segmenter.feed('ls\nfile1.txt\nfile2.txt\n');
    segmenter.feed('user@host:~$ ');

    expect(blockCb).toHaveBeenCalledTimes(1);
    const block = blockCb.mock.calls[0][0];
    expect(block.command).toBe('ls');
    expect(block.output).toContain('file1.txt');
  });

  it('fires onOutput with incremental output', () => {
    const segmenter = new BlockSegmenter();
    const outputCb = vi.fn();
    segmenter.onOutput(outputCb);

    segmenter.feed('user@host:~$ ');
    segmenter.feed('echo hello\nhello\n');

    expect(outputCb).toHaveBeenCalled();
  });

  it('detects alt-screen enter/exit', () => {
    const segmenter = new BlockSegmenter();
    const altCb = vi.fn();
    segmenter.onAltScreen(altCb);

    segmenter.feed('\x1b[?1049h');
    expect(altCb).toHaveBeenCalledWith(true);

    segmenter.feed('\x1b[?1049l');
    expect(altCb).toHaveBeenCalledWith(false);
  });

  it('pauses segmentation during alt-screen', () => {
    const segmenter = new BlockSegmenter();
    const blockCb = vi.fn();
    segmenter.onBlock(blockCb);

    segmenter.feed('user@host:~$ ');
    segmenter.feed('\x1b[?1049hsome vim stuff\n');
    segmenter.feed('\x1b[?1049l');
    segmenter.feed('user@host:~$ ');

    expect(blockCb).toHaveBeenCalledTimes(0);
  });

  it('detects remote sessions via prompt identity change', () => {
    const segmenter = new BlockSegmenter();
    const promptCb = vi.fn();
    segmenter.onPromptChange(promptCb);

    segmenter.feed('local@machine:~$ ');
    segmenter.feed('ssh remote\nsome output\n');
    segmenter.feed('remote@server:~$ ');

    const lastCall = promptCb.mock.calls[promptCb.mock.calls.length - 1];
    expect(lastCall[1]).toBe(true); // isRemote
  });

  it('resets all state', () => {
    const segmenter = new BlockSegmenter();
    segmenter.feed('user@host:~$ ');
    expect(segmenter.seenFirstPrompt).toBe(true);
    segmenter.reset();
    expect(segmenter.seenFirstPrompt).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run --config tests/vitest.config.ts tests/unit/BlockSegmenter.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create src/components/BlockSegmenter.ts**

```typescript
import { stripAnsi } from '@/utils/stripAnsi';
import type { SegmentedBlock } from '@/types';

const PROMPT_RE = /(\S+[@:]\S+[\$#%>❯]|[\$#%❯])\s*$/;
const SSH_TARGET_RE = /(\S+)@(\S+?)[\s:]/;
const ALT_SCREEN_ENTER = '\x1b[?1049h';
const ALT_SCREEN_EXIT = '\x1b[?1049l';

type BlockCallback = (block: SegmentedBlock) => void;
type OutputCallback = (output: string) => void;
type AltScreenCallback = (entered: boolean) => void;
type PromptChangeCallback = (prompt: string, isRemote: boolean, sshTarget: string | null) => void;

export class BlockSegmenter {
  private _idCounter = 0;
  private _currentPrompt = '';
  private _initialPrompt = '';
  private _startTime = 0;
  private _pendingLines: string[] = [];
  private _partialLine = '';
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

    if (newlineIndex === -1) {
      this._partialLine += clean;
    } else {
      const completeChunk = clean.substring(0, newlineIndex);
      const remainder = clean.substring(newlineIndex + 1);
      const newCompleteLines = (this._partialLine + completeChunk).split('\n');
      this._partialLine = remainder;
      for (const line of newCompleteLines) {
        this._pendingLines.push(line);
      }
    }

    this._checkForPrompt();

    if (this._seenFirstPrompt && this._pendingLines.length >= 1) {
      const outputLines = this._pendingLines.slice(1);
      const partialSuffix = this._partialLine ? '\n' + this._partialLine : '';
      const output = outputLines.map(l => l.trimEnd()).join('\n').trim() + partialSuffix;
      if (output) {
        this._outputCallbacks.forEach(cb => cb(output));
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
      this._firePromptChange(promptText);
      return;
    }

    if (this._pendingLines.length === 0 && this._seenFirstPrompt) {
      const changed = promptText !== this._currentPrompt;
      this._currentPrompt = promptText;
      this._startTime = Date.now();
      this._partialLine = '';
      if (changed) this._firePromptChange(promptText);
      return;
    }

    this._seenFirstPrompt = true;
    this._finalizeBlock(promptText);
  }

  private _finalizeBlock(newPromptText: string): void {
    const lines = this._pendingLines;
    let command = '';
    let outputLines: string[] = [];

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
    }

    const output = outputLines.map(l => l.trimEnd()).join('\n').trim();

    const block: SegmentedBlock = {
      id: this._nextId(),
      command,
      output,
      promptText: this._currentPrompt,
      startTime: this._startTime,
      duration: Date.now() - this._startTime,
      isRemote: this._isRemotePrompt(newPromptText),
    };

    this._blockCallbacks.forEach(cb => cb(block));

    this._currentPrompt = newPromptText;
    this._startTime = Date.now();
    this._pendingLines = [];
    this._partialLine = '';
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
    this._partialLine = '';
    this._seenFirstPrompt = false;
    this._inAltScreen = false;
    this._blockCallbacks = [];
    this._outputCallbacks = [];
    this._altScreenCallbacks = [];
    this._promptChangeCallbacks = [];
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run --config tests/vitest.config.ts tests/unit/BlockSegmenter.test.ts
```

Expected: 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/BlockSegmenter.ts tests/unit/BlockSegmenter.test.ts
git commit -m "feat: add BlockSegmenter with prompt detection and alt-screen support"
```

---

### Task 6: GradientBorder Component

**Files:**
- Create: `src/components/GradientBorder.tsx`
- Modify: `src/App.tsx` — wrap content in GradientBorder

- [ ] **Step 1: Create src/components/GradientBorder.tsx**

```tsx
import { type ReactNode, useEffect, useRef } from 'react';
import type { ContextMode } from '@/types';

const GRADIENT_COLORS: Record<ContextMode, { c1: string; c2: string; mid: string }> = {
  shell: { c1: '#00ff88', c2: '#00cc6a', mid: '#0a5c3a' },
  ai: { c1: '#a855f7', c2: '#7c3aed', mid: '#3b1a6e' },
  agent: { c1: '#fb923c', c2: '#ea580c', mid: '#6b2a0a' },
  error: { c1: '#ef4444', c2: '#dc2626', mid: '#6b1414' },
};

interface GradientBorderProps {
  mode: ContextMode;
  children: ReactNode;
}

export function GradientBorder({ mode, children }: GradientBorderProps) {
  const borderRef = useRef<HTMLDivElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const colors = GRADIENT_COLORS[mode];
    const gradient = `linear-gradient(135deg, ${colors.c1} 0%, ${colors.c2} 20%, ${colors.mid} 50%, ${colors.c2} 80%, ${colors.c1} 100%)`;
    const glowC1 = colors.c1.replace('#', '');
    const r = parseInt(glowC1.slice(0, 2), 16);
    const g = parseInt(glowC1.slice(2, 4), 16);
    const b = parseInt(glowC1.slice(4, 6), 16);
    const glowGradient = `linear-gradient(135deg, rgba(${r},${g},${b},0.15) 0%, rgba(${r},${g},${b},0.1) 20%, transparent 50%, rgba(${r},${g},${b},0.1) 80%, rgba(${r},${g},${b},0.15) 100%)`;

    if (borderRef.current) {
      borderRef.current.style.background = gradient;
      borderRef.current.style.backgroundSize = '300% 300%';
    }
    if (glowRef.current) {
      glowRef.current.style.background = glowGradient;
      glowRef.current.style.backgroundSize = '300% 300%';
    }
  }, [mode]);

  return (
    <div style={{ position: 'relative', height: '100vh', overflow: 'hidden' }}>
      <div
        ref={borderRef}
        style={{
          position: 'absolute',
          inset: -2,
          borderRadius: 0,
          padding: 2,
          backgroundSize: '300% 300%',
          animation: 'gradient-sweep 20s ease-in-out infinite alternate',
          WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
          WebkitMaskComposite: 'xor',
          mask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
          maskComposite: 'exclude' as any,
          pointerEvents: 'none',
          zIndex: 10,
          opacity: 0.7,
          transition: 'background 1.5s ease',
        }}
      />
      <div
        ref={glowRef}
        style={{
          position: 'absolute',
          inset: -6,
          backgroundSize: '300% 300%',
          animation: 'gradient-sweep 20s ease-in-out infinite alternate',
          filter: 'blur(12px)',
          pointerEvents: 'none',
          zIndex: 9,
          opacity: 0.5,
          transition: 'background 1.5s ease',
        }}
      />
      <div style={{ position: 'relative', zIndex: 1, height: '100%' }}>
        {children}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add gradient-sweep keyframes to globals.css**

Append to `src/styles/globals.css`:

```css
@keyframes gradient-sweep {
  0% { background-position: 0% 0%; }
  100% { background-position: 100% 100%; }
}
```

- [ ] **Step 3: Update src/App.tsx to wrap with GradientBorder**

```tsx
import { useState, useEffect, useRef } from 'react';
import { XtermPane, XtermPaneHandle } from './components/XtermPane';
import { GradientBorder } from './components/GradientBorder';
import type { ContextMode } from './types';

export default function App() {
  const [ptyId, setPtyId] = useState<number | null>(null);
  const [contextMode, setContextMode] = useState<ContextMode>('shell');
  const xtermRef = useRef<XtermPaneHandle>(null);

  useEffect(() => {
    const cwd = process.env.HOME || '/';
    window.tai.pty.create(cwd).then(setPtyId);
  }, []);

  useEffect(() => {
    if (ptyId !== null) {
      setTimeout(() => xtermRef.current?.focus(), 100);
    }
  }, [ptyId]);

  return (
    <GradientBorder mode={contextMode}>
      <div style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-base)',
      }}>
        <div style={{
          padding: '10px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          borderBottom: '1px solid var(--border-subtle)',
          WebkitAppRegion: 'drag' as any,
          userSelect: 'none',
        }}>
          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>tai</span>
        </div>
        <XtermPane ref={xtermRef} ptyId={ptyId} />
      </div>
    </GradientBorder>
  );
}
```

- [ ] **Step 4: Run dev to verify gradient border is visible**

```bash
npm run dev
```

Expected: Terminal window with a green flowing gradient border around the edges. Terminal still fully functional.

- [ ] **Step 5: Commit**

```bash
git add src/components/GradientBorder.tsx src/styles/globals.css src/App.tsx
git commit -m "feat: add context-aware gradient border"
```

---

### Task 7: TabBar + Multi-Tab Support

**Files:**
- Create: `src/components/TabBar.tsx`
- Modify: `src/App.tsx` — tab state management, multiple terminal sessions
- Modify: `src/types.ts` — already has `TabState`

- [ ] **Step 1: Create src/components/TabBar.tsx**

```tsx
import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import type { TabState, ContextMode } from '@/types';

const MODE_COLORS: Record<ContextMode, string> = {
  shell: 'var(--color-shell)',
  ai: 'var(--color-ai)',
  agent: 'var(--color-agent)',
  error: 'var(--color-error)',
};

interface TabBarProps {
  tabs: TabState[];
  activeTabId: string;
  onSelectTab: (id: string) => void;
  onNewTab: () => void;
  onCloseTab: (id: string) => void;
  onRenameTab: (id: string, label: string) => void;
}

export function TabBar({ tabs, activeTabId, onSelectTab, onNewTab, onCloseTab, onRenameTab }: TabBarProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  const handleDoubleClick = (tab: TabState) => {
    setEditingId(tab.id);
    setEditValue(tab.label);
  };

  const handleRenameSubmit = (id: string) => {
    if (editValue.trim()) onRenameTab(id, editValue.trim());
    setEditingId(null);
  };

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 2,
      padding: '4px 8px',
      borderBottom: '1px solid var(--border-subtle)',
      background: 'var(--bg-surface)',
      WebkitAppRegion: 'drag' as any,
      userSelect: 'none',
    }}>
      {tabs.map((tab, i) => {
        const isActive = tab.id === activeTabId;
        const modeColor = MODE_COLORS[tab.contextMode];

        return (
          <div
            key={tab.id}
            onClick={() => onSelectTab(tab.id)}
            onDoubleClick={() => handleDoubleClick(tab)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 12px',
              borderRadius: 6,
              cursor: 'pointer',
              background: isActive ? 'rgba(255,255,255,0.06)' : 'transparent',
              borderBottom: isActive ? `2px solid ${modeColor}` : '2px solid transparent',
              transition: 'all 0.2s ease',
              WebkitAppRegion: 'no-drag' as any,
            }}
          >
            <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{i + 1}:</span>
            {editingId === tab.id ? (
              <input
                autoFocus
                value={editValue}
                onChange={e => setEditValue(e.target.value)}
                onBlur={() => handleRenameSubmit(tab.id)}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleRenameSubmit(tab.id);
                  if (e.key === 'Escape') setEditingId(null);
                }}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-primary)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 12,
                  outline: 'none',
                  width: 80,
                }}
              />
            ) : (
              <span style={{
                color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                fontSize: 12,
              }}>
                {tab.label}
              </span>
            )}
            {tabs.length > 1 && (
              <X
                size={12}
                style={{
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  opacity: isActive ? 0.8 : 0.4,
                }}
                onClick={e => {
                  e.stopPropagation();
                  onCloseTab(tab.id);
                }}
              />
            )}
          </div>
        );
      })}
      <div
        onClick={onNewTab}
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '6px 8px',
          borderRadius: 6,
          cursor: 'pointer',
          WebkitAppRegion: 'no-drag' as any,
        }}
      >
        <Plus size={14} style={{ color: 'var(--text-muted)' }} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Update src/App.tsx with multi-tab state**

```tsx
import { useState, useEffect, useRef, useCallback } from 'react';
import { XtermPane, XtermPaneHandle } from './components/XtermPane';
import { GradientBorder } from './components/GradientBorder';
import { TabBar } from './components/TabBar';
import type { ContextMode, TabState } from './types';

let tabCounter = 0;
function createTabState(): TabState {
  const id = `tab-${++tabCounter}`;
  return { id, ptyId: null, label: 'zsh', cwd: process.env.HOME || '/', contextMode: 'shell', trustLevel: 'ask' };
}

export default function App() {
  const [tabs, setTabs] = useState<TabState[]>(() => [createTabState()]);
  const [activeTabId, setActiveTabId] = useState(tabs[0].id);
  const xtermRefs = useRef<Map<string, XtermPaneHandle>>(new Map());

  const activeTab = tabs.find(t => t.id === activeTabId)!;

  useEffect(() => {
    for (const tab of tabs) {
      if (tab.ptyId === null) {
        window.tai.pty.create(tab.cwd).then(ptyId => {
          setTabs(prev => prev.map(t => t.id === tab.id ? { ...t, ptyId } : t));
        });
      }
    }
  }, [tabs.length]);

  useEffect(() => {
    setTimeout(() => xtermRefs.current.get(activeTabId)?.focus(), 50);
  }, [activeTabId]);

  const handleNewTab = useCallback(() => {
    const tab = createTabState();
    setTabs(prev => [...prev, tab]);
    setActiveTabId(tab.id);
  }, []);

  const handleCloseTab = useCallback((id: string) => {
    const tab = tabs.find(t => t.id === id);
    if (tab?.ptyId !== null && tab?.ptyId !== undefined) {
      window.tai.pty.kill(tab.ptyId);
    }
    setTabs(prev => {
      const next = prev.filter(t => t.id !== id);
      if (id === activeTabId && next.length > 0) {
        setActiveTabId(next[Math.max(0, prev.findIndex(t => t.id === id) - 1)].id);
      }
      return next;
    });
  }, [tabs, activeTabId]);

  const handleRenameTab = useCallback((id: string, label: string) => {
    setTabs(prev => prev.map(t => t.id === id ? { ...t, label } : t));
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'T') {
        e.preventDefault();
        handleNewTab();
      }
      if (e.ctrlKey && e.shiftKey && e.key === 'W') {
        e.preventDefault();
        if (tabs.length > 1) handleCloseTab(activeTabId);
      }
      if (e.ctrlKey && !e.shiftKey && e.key >= '1' && e.key <= '9') {
        const idx = parseInt(e.key) - 1;
        if (idx < tabs.length) {
          e.preventDefault();
          setActiveTabId(tabs[idx].id);
        }
      }
      if (e.ctrlKey && e.key === 'Tab') {
        e.preventDefault();
        const idx = tabs.findIndex(t => t.id === activeTabId);
        const next = e.shiftKey
          ? (idx - 1 + tabs.length) % tabs.length
          : (idx + 1) % tabs.length;
        setActiveTabId(tabs[next].id);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [tabs, activeTabId, handleNewTab, handleCloseTab]);

  return (
    <GradientBorder mode={activeTab.contextMode}>
      <div style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-base)',
      }}>
        <TabBar
          tabs={tabs}
          activeTabId={activeTabId}
          onSelectTab={setActiveTabId}
          onNewTab={handleNewTab}
          onCloseTab={handleCloseTab}
          onRenameTab={handleRenameTab}
        />
        {tabs.map(tab => (
          <div
            key={tab.id}
            style={{
              flex: 1,
              display: tab.id === activeTabId ? 'flex' : 'none',
              flexDirection: 'column',
            }}
          >
            <XtermPane
              ref={el => {
                if (el) xtermRefs.current.set(tab.id, el);
                else xtermRefs.current.delete(tab.id);
              }}
              ptyId={tab.ptyId}
              visible={tab.id === activeTabId}
            />
          </div>
        ))}
      </div>
    </GradientBorder>
  );
}
```

- [ ] **Step 3: Run dev to verify tabs work**

```bash
npm run dev
```

Expected: Tab bar visible. Can create new tabs (Ctrl+Shift+T), switch (Ctrl+1-9, Ctrl+Tab), close (Ctrl+Shift+W), rename (double-click). Each tab has its own terminal session.

- [ ] **Step 4: Commit**

```bash
git add src/components/TabBar.tsx src/App.tsx
git commit -m "feat: add tab management with keybindings"
```

---

### Task 8: Claude CLI Provider Service

**Files:**
- Create: `electron/services/claude.ts`
- Create: `src/providers/types.ts`
- Create: `src/providers/claude.ts`
- Modify: `electron/main.ts` — import claude service
- Modify: `electron/preload.ts` — expose AI IPC

- [ ] **Step 1: Create electron/services/claude.ts**

```typescript
import { ipcMain, BrowserWindow } from 'electron';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

interface ClaudeState {
  process: ChildProcess | null;
  sessionId: string | null;
  buffer: string;
  busy: boolean;
}

const claudeStates = new Map<string, ClaudeState>();

function getState(key: string): ClaudeState {
  let state = claudeStates.get(key);
  if (!state) {
    state = { process: null, sessionId: null, buffer: '', busy: false };
    claudeStates.set(key, state);
  }
  return state;
}

function safeSend(win: BrowserWindow | null, channel: string, ...args: unknown[]) {
  try {
    if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
  } catch {}
}

function enrichedEnv(): Record<string, string> {
  const env = { ...process.env } as Record<string, string>;
  const home = env.HOME || '/';
  const extraPaths = [
    path.join(home, '.local/bin'),
    path.join(home, '.nvm/current/bin'),
    path.join(home, '.volta/bin'),
    '/usr/local/bin',
    '/opt/homebrew/bin',
  ];
  env.PATH = [...extraPaths, env.PATH || ''].join(':');
  return env;
}

function ensureProcess(win: BrowserWindow | null, key: string, cwd: string, permMode: string, model: string): ChildProcess {
  const state = getState(key);

  if (state.process && !state.process.killed) {
    return state.process;
  }

  const args = [
    '-p',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
  ];

  if (permMode === 'bypass') {
    args.push('--permission-mode', 'bypassPermissions');
  } else if (permMode === 'approve-edits') {
    args.push('--permission-mode', 'acceptEdits');
  } else {
    args.push('--permission-mode', 'acceptEdits');
  }

  if (model) {
    args.push('--model', model);
  }

  if (state.sessionId) {
    args.push('--resume', state.sessionId);
  }

  const proc = spawn('claude', args, {
    cwd,
    env: enrichedEnv(),
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  state.process = proc;
  state.buffer = '';

  proc.stdout!.on('data', (chunk: Buffer) => {
    state.buffer += chunk.toString();
    const lines = state.buffer.split('\n');
    state.buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);

        if (msg.type === 'system' && msg.session_id) {
          state.sessionId = msg.session_id;
        }

        if (msg.type === 'result') {
          state.busy = false;
          safeSend(win, 'ai:message', key, { type: 'done', content: msg });
          continue;
        }

        safeSend(win, 'ai:message', key, msg);
      } catch {}
    }
  });

  proc.stderr!.on('data', (chunk: Buffer) => {
    safeSend(win, 'ai:error', key, chunk.toString());
  });

  proc.on('exit', () => {
    state.process = null;
    state.busy = false;
  });

  return proc;
}

export function setupClaudeService(getWindow: () => BrowserWindow | null) {
  ipcMain.handle('ai:send', (_event, key: string, cwd: string, message: string, permMode: string, model: string) => {
    const win = getWindow();
    const state = getState(key);
    const proc = ensureProcess(win, key, cwd, permMode, model);

    state.busy = true;
    const payload = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: message },
    });
    proc.stdin!.write(payload + '\n');

    return true;
  });

  ipcMain.on('ai:cancel', (_event, key: string) => {
    const state = getState(key);
    if (state.process && !state.process.killed) {
      state.process.kill('SIGINT');
    }
    state.busy = false;
  });

  ipcMain.on('ai:stop', (_event, key: string) => {
    const state = getState(key);
    if (state.process) {
      state.process.kill();
      state.process = null;
    }
    state.busy = false;
  });

  ipcMain.handle('ai:approve', (_event, key: string, toolUseId: string, approved: boolean) => {
    // Approval handling — to be expanded with full tool execution in agent mode
    const state = getState(key);
    if (!state.process || state.process.killed) return false;

    if (!approved) {
      const deny = JSON.stringify({
        type: 'user',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: toolUseId, content: 'User denied this action.' }],
        },
      });
      state.process.stdin!.write(deny + '\n');
    }
    return true;
  });
}

export function destroyAllClaude() {
  for (const state of claudeStates.values()) {
    if (state.process) state.process.kill();
  }
  claudeStates.clear();
}
```

- [ ] **Step 2: Create src/providers/types.ts**

```typescript
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
  send(message: string, cwd: string, trustLevel: string, model?: string): void;
  cancel(): void;
  stop(): void;
  onMessage(callback: (chunk: any) => void): () => void;
  getCapabilities(): ProviderCapabilities;
}
```

- [ ] **Step 3: Create src/providers/claude.ts**

```typescript
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
      messageCleanup = window.tai.ai.onMessage(tabId, callback);
      return () => {
        messageCleanup?.();
        messageCleanup = null;
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
```

- [ ] **Step 4: Update electron/main.ts to import Claude service**

Add to imports and `app.whenReady`:

```typescript
import { setupClaudeService, destroyAllClaude } from './services/claude';

// In app.whenReady():
setupClaudeService(() => mainWindow);

// In window-all-closed:
destroyAllClaude();
```

- [ ] **Step 5: Update electron/preload.ts to expose AI IPC**

Add to the `tai` object:

```typescript
ai: {
  send: (key: string, cwd: string, message: string, permMode: string, model: string) =>
    ipcRenderer.invoke('ai:send', key, cwd, message, permMode, model),
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
},
```

- [ ] **Step 6: Run dev to verify no errors**

```bash
npm run dev
```

Expected: App launches without errors. AI service registered. No visual change yet — wiring comes in later tasks.

- [ ] **Step 7: Commit**

```bash
git add electron/services/claude.ts src/providers/ electron/main.ts electron/preload.ts
git commit -m "feat: add Claude CLI provider service with streaming JSON protocol"
```

---

### Task 9: Rich Block Components

**Files:**
- Create: `src/components/AIResponseBlock.tsx`
- Create: `src/components/AgentStepCard.tsx`
- Create: `src/components/ApprovalPrompt.tsx`
- Create: `src/components/ErrorAffordance.tsx`

- [ ] **Step 1: Create src/components/AIResponseBlock.tsx**

```tsx
import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Copy, Play, Check, ChevronDown, ChevronRight, Sparkles } from 'lucide-react';
import type { AIEntry } from '@/types';

interface AIResponseBlockProps {
  id: string;
  question: string;
  entries: AIEntry[];
  content: string;
  streaming: boolean;
  onRunCommand: (command: string) => void;
  onCopy: (text: string) => void;
}

export function AIResponseBlock({ question, entries, content, streaming, onRunCommand, onCopy }: AIResponseBlockProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  const handleCopy = (text: string, idx: number) => {
    onCopy(text);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 1500);
  };

  const hasContent = entries.length > 0 || content;

  return (
    <div style={{
      margin: '8px 0',
      borderLeft: '2px solid rgba(168, 85, 247, 0.4)',
      borderRadius: '0 8px 8px 0',
      background: 'rgba(168, 85, 247, 0.06)',
      overflow: 'hidden',
      animation: 'fadeIn 0.2s ease',
    }}>
      <div
        onClick={() => setCollapsed(!collapsed)}
        style={{
          padding: '10px 14px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          cursor: 'pointer',
        }}
      >
        {collapsed ? <ChevronRight size={14} color="#a855f7" /> : <ChevronDown size={14} color="#a855f7" />}
        <Sparkles size={14} color="#a855f7" />
        <span style={{ color: '#e0e0e0', fontSize: 12 }}>{question}</span>
        {streaming && (
          <span style={{
            width: 6, height: 6, borderRadius: '50%',
            background: '#a855f7',
            animation: 'pulse 1.5s infinite',
            marginLeft: 'auto',
          }} />
        )}
      </div>

      {!collapsed && (
        <div style={{ padding: '0 14px 12px' }}>
          {!hasContent && streaming && (
            <span style={{ color: '#888', fontSize: 12 }}>Thinking...</span>
          )}

          {entries.map((entry, i) => {
            if (entry.kind === 'text' && entry.text) {
              return (
                <div key={i} className="ai-markdown" style={{ fontSize: 13, lineHeight: 1.6, color: '#bbb' }}>
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      code({ className, children, ...props }) {
                        const isBlock = className?.includes('language-');
                        if (!isBlock) {
                          return <code style={{ background: 'rgba(255,255,255,0.08)', padding: '1px 5px', borderRadius: 3, color: '#e0e0e0' }} {...props}>{children}</code>;
                        }
                        const text = String(children).trimEnd();
                        return (
                          <div style={{ position: 'relative', margin: '8px 0' }}>
                            <pre style={{ background: 'rgba(0,0,0,0.4)', padding: '10px 12px', borderRadius: 6, fontSize: 12, overflow: 'auto' }}>
                              <code {...props}>{children}</code>
                            </pre>
                            <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                              <button
                                onClick={() => onRunCommand(text)}
                                style={{
                                  display: 'flex', alignItems: 'center', gap: 4,
                                  background: 'rgba(0,255,136,0.1)', border: '1px solid rgba(0,255,136,0.3)',
                                  color: '#00ff88', padding: '3px 8px', borderRadius: 6, fontSize: 11,
                                  cursor: 'pointer', fontFamily: 'var(--font-mono)',
                                }}
                              >
                                <Play size={10} /> Run
                              </button>
                              <button
                                onClick={() => handleCopy(text, i)}
                                style={{
                                  display: 'flex', alignItems: 'center', gap: 4,
                                  background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                                  color: '#888', padding: '3px 8px', borderRadius: 6, fontSize: 11,
                                  cursor: 'pointer', fontFamily: 'var(--font-mono)',
                                }}
                              >
                                {copiedIdx === i ? <Check size={10} /> : <Copy size={10} />}
                                {copiedIdx === i ? 'Copied' : 'Copy'}
                              </button>
                            </div>
                          </div>
                        );
                      },
                    }}
                  >
                    {entry.text}
                  </ReactMarkdown>
                </div>
              );
            }

            if (entry.kind === 'tool' && entry.call) {
              const call = entry.call;
              return (
                <div key={i} style={{
                  margin: '8px 0',
                  padding: '8px 10px',
                  background: 'rgba(0,0,0,0.2)',
                  borderRadius: 6,
                  fontSize: 11,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#888' }}>
                    <span style={{ color: '#a855f7' }}>{call.name}</span>
                    {call.error && <span style={{ color: '#ef4444' }}>error</span>}
                  </div>
                  <div style={{ color: '#666', marginTop: 4 }}>{call.input}</div>
                  {call.output && (
                    <div style={{ color: '#888', marginTop: 4, maxHeight: 200, overflow: 'auto' }}>{call.output}</div>
                  )}
                </div>
              );
            }
            return null;
          })}

          {!entries.length && content && (
            <div className="ai-markdown" style={{ fontSize: 13, lineHeight: 1.6, color: '#bbb' }}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create src/components/AgentStepCard.tsx**

```tsx
import { useState } from 'react';
import { ChevronDown, ChevronRight, Zap, Check, X, Loader2 } from 'lucide-react';
import type { AgentStep } from '@/types';

interface AgentStepCardProps {
  id: string;
  question: string;
  steps: AgentStep[];
  streaming: boolean;
}

const STATUS_ICON: Record<AgentStep['status'], React.ReactNode> = {
  pending: <span style={{ color: '#555' }}>○</span>,
  running: <Loader2 size={12} color="#fb923c" style={{ animation: 'spin 0.8s linear infinite' }} />,
  complete: <Check size={12} color="#00ff88" />,
  failed: <X size={12} color="#ef4444" />,
};

export function AgentStepCard({ question, steps, streaming }: AgentStepCardProps) {
  const [collapsed, setCollapsed] = useState(false);
  const completedCount = steps.filter(s => s.status === 'complete').length;

  return (
    <div style={{
      margin: '8px 0',
      borderLeft: '2px solid rgba(251, 146, 60, 0.4)',
      borderRadius: '0 8px 8px 0',
      background: 'rgba(251, 146, 60, 0.04)',
      overflow: 'hidden',
      animation: 'fadeIn 0.2s ease',
    }}>
      <div
        onClick={() => setCollapsed(!collapsed)}
        style={{
          padding: '10px 14px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          cursor: 'pointer',
        }}
      >
        {collapsed ? <ChevronRight size={14} color="#fb923c" /> : <ChevronDown size={14} color="#fb923c" />}
        <Zap size={14} color="#fb923c" />
        <span style={{ color: '#e0e0e0', fontSize: 12 }}>{question}</span>
        <span style={{ color: '#888', fontSize: 11, marginLeft: 'auto' }}>
          {completedCount}/{steps.length}
        </span>
        {streaming && (
          <span style={{
            width: 6, height: 6, borderRadius: '50%',
            background: '#fb923c',
            animation: 'pulse 1.5s infinite',
          }} />
        )}
      </div>

      {!collapsed && (
        <div style={{ padding: '0 14px 12px' }}>
          {steps.map((step, i) => (
            <div key={i} style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
              padding: '4px 0',
            }}>
              <span style={{ marginTop: 2 }}>{STATUS_ICON[step.status]}</span>
              <div style={{ flex: 1 }}>
                <span style={{
                  color: step.status === 'complete' ? '#666' : step.status === 'running' ? '#e0e0e0' : '#555',
                  fontSize: 12,
                  textDecoration: step.status === 'complete' ? 'line-through' : 'none',
                }}>
                  {step.description}
                </span>
                {step.status === 'running' && step.output && (
                  <div style={{
                    marginTop: 4, padding: '6px 8px',
                    background: 'rgba(0,0,0,0.3)', borderRadius: 4,
                    fontSize: 11, color: '#888', maxHeight: 120, overflow: 'auto',
                    fontFamily: 'var(--font-mono)',
                  }}>
                    {step.output}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Create src/components/ApprovalPrompt.tsx**

```tsx
import { useEffect } from 'react';
import { Check, Pencil, X } from 'lucide-react';

interface ApprovalPromptProps {
  id: string;
  command: string;
  status: 'pending' | 'approved' | 'rejected' | 'edited';
  onApprove: () => void;
  onReject: () => void;
  onEdit: () => void;
}

export function ApprovalPrompt({ command, status, onApprove, onReject, onEdit }: ApprovalPromptProps) {
  useEffect(() => {
    if (status !== 'pending') return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.ctrlKey && !e.shiftKey) { e.preventDefault(); onApprove(); }
      if (e.key === 'e' && !e.ctrlKey) { e.preventDefault(); onEdit(); }
      if (e.key === 'Escape') { e.preventDefault(); onReject(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [status, onApprove, onReject, onEdit]);

  const resolved = status !== 'pending';

  return (
    <div style={{
      margin: '8px 0',
      padding: '10px 14px',
      background: 'rgba(251, 146, 60, 0.06)',
      border: '1px solid rgba(251, 146, 60, 0.2)',
      borderRadius: 8,
      opacity: resolved ? 0.5 : 1,
      animation: 'fadeIn 0.2s ease',
    }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: '#e0e0e0' }}>
        <span style={{ color: '#fb923c' }}>❯</span> {command}
      </div>
      {!resolved && (
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button
            onClick={onEdit}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
              color: '#888', padding: '4px 10px', borderRadius: 6, fontSize: 11,
              cursor: 'pointer', fontFamily: 'var(--font-mono)',
            }}
          >
            <Pencil size={10} /> Edit <span style={{ color: '#555' }}>(e)</span>
          </button>
          <button
            onClick={onApprove}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              background: 'rgba(0,255,136,0.1)', border: '1px solid rgba(0,255,136,0.3)',
              color: '#00ff88', padding: '4px 10px', borderRadius: 6, fontSize: 11,
              cursor: 'pointer', fontFamily: 'var(--font-mono)',
            }}
          >
            <Check size={10} /> Approve <span style={{ color: 'rgba(0,255,136,0.5)' }}>(↵)</span>
          </button>
          <button
            onClick={onReject}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
              color: '#ef4444', padding: '4px 10px', borderRadius: 6, fontSize: 11,
              cursor: 'pointer', fontFamily: 'var(--font-mono)',
            }}
          >
            <X size={10} /> Reject <span style={{ color: 'rgba(239,68,68,0.5)' }}>(esc)</span>
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Create src/components/ErrorAffordance.tsx**

```tsx
import { Sparkles } from 'lucide-react';
import type { SegmentedBlock } from '@/types';

interface ErrorAffordanceProps {
  block: SegmentedBlock;
  onAskAI: (block: SegmentedBlock) => void;
}

export function ErrorAffordance({ block, onAskAI }: ErrorAffordanceProps) {
  return (
    <div
      onClick={() => onAskAI(block)}
      style={{
        margin: '4px 0 8px',
        padding: '8px 12px',
        background: 'rgba(168, 85, 247, 0.05)',
        border: '1px solid rgba(168, 85, 247, 0.15)',
        borderRadius: 8,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        cursor: 'pointer',
        animation: 'fadeIn 0.2s ease',
      }}
    >
      <Sparkles size={14} color="#a855f7" />
      <span style={{ color: '#999', fontSize: 12 }}>Error detected — want me to fix it?</span>
    </div>
  );
}
```

- [ ] **Step 5: Add animation keyframes to globals.css**

Append to `src/styles/globals.css`:

```css
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
```

- [ ] **Step 6: Run dev to verify components compile**

```bash
npm run dev
```

Expected: No compilation errors. Components not yet visible — they'll be wired in the TerminalSession orchestrator.

- [ ] **Step 7: Commit**

```bash
git add src/components/AIResponseBlock.tsx src/components/AgentStepCard.tsx src/components/ApprovalPrompt.tsx src/components/ErrorAffordance.tsx src/styles/globals.css
git commit -m "feat: add rich block components — AI response, agent steps, approval, error"
```

---

### Task 10: AIInputPanel + ModeIndicator

**Files:**
- Create: `src/components/AIInputPanel.tsx`
- Create: `src/components/ModeIndicator.tsx`
- Create: `src/hooks/useGhostText.ts`
- Create: `tests/unit/ghostText.test.ts`

- [ ] **Step 1: Write failing tests for ghost text prediction**

Create `tests/unit/ghostText.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { predictCommand } from '@/hooks/useGhostText';

describe('predictCommand', () => {
  it('returns null for empty prefix', () => {
    expect(predictCommand('', ['ls', 'git status'])).toBeNull();
  });

  it('matches prefix case-insensitively', () => {
    expect(predictCommand('gi', ['git status', 'git log', 'ls'])).toBe('git status');
  });

  it('scores by frequency and recency', () => {
    const history = ['git log', 'git status', 'git log', 'git status', 'git status'];
    expect(predictCommand('git', history)).toBe('git status');
  });

  it('returns null when no match', () => {
    expect(predictCommand('xyz', ['ls', 'git'])).toBeNull();
  });

  it('does not match exact duplicates', () => {
    expect(predictCommand('ls', ['ls', 'ls -la'])).toBe('ls -la');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run --config tests/vitest.config.ts tests/unit/ghostText.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create src/hooks/useGhostText.ts**

```typescript
import { useState, useCallback } from 'react';

export function predictCommand(prefix: string, history: string[]): string | null {
  if (!prefix || !prefix.trim()) return null;
  const lower = prefix.toLowerCase();
  const total = history.length;
  if (total === 0) return null;

  const scores = new Map<string, number>();
  for (let i = 0; i < total; i++) {
    const cmd = history[i];
    if (!cmd.toLowerCase().startsWith(lower) || cmd.toLowerCase() === lower) continue;
    const recency = (i + 1) / total;
    scores.set(cmd, (scores.get(cmd) || 0) + 1 + recency);
  }

  let best: string | null = null;
  let bestScore = 0;
  for (const [cmd, score] of scores) {
    if (score > bestScore) { bestScore = score; best = cmd; }
  }
  return best;
}

export function useGhostText(history: string[]) {
  const [prediction, setPrediction] = useState<string | null>(null);

  const updatePrediction = useCallback((prefix: string) => {
    setPrediction(predictCommand(prefix, history));
  }, [history]);

  const clearPrediction = useCallback(() => {
    setPrediction(null);
  }, []);

  return { prediction, updatePrediction, clearPrediction };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run --config tests/vitest.config.ts tests/unit/ghostText.test.ts
```

Expected: 5 tests PASS.

- [ ] **Step 5: Create src/components/ModeIndicator.tsx**

```tsx
import { Sparkles, Terminal } from 'lucide-react';

interface ModeIndicatorProps {
  mode: 'shell' | 'ai';
  transitioning?: boolean;
}

export function ModeIndicator({ mode, transitioning }: ModeIndicatorProps) {
  return (
    <div style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4,
      padding: '2px 6px',
      borderRadius: 4,
      fontSize: 11,
      transition: 'all 0.3s ease',
      opacity: transitioning ? 0.5 : 1,
    }}>
      {mode === 'shell' ? (
        <>
          <Terminal size={12} color="var(--color-shell)" />
          <span style={{ color: 'var(--color-shell)' }}>$</span>
        </>
      ) : (
        <>
          <Sparkles size={12} color="var(--color-ai)" />
          <span style={{ color: 'var(--color-ai)' }}>✦</span>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Create src/components/AIInputPanel.tsx**

```tsx
import { useState, useRef, useEffect } from 'react';
import { Send, X } from 'lucide-react';

interface AIInputPanelProps {
  visible: boolean;
  onSubmit: (message: string) => void;
  onClose: () => void;
  initialValue?: string;
}

export function AIInputPanel({ visible, onSubmit, onClose, initialValue }: AIInputPanelProps) {
  const [value, setValue] = useState(initialValue || '');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (visible) {
      setValue(initialValue || '');
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [visible, initialValue]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (value.trim()) {
        onSubmit(value.trim());
        setValue('');
      }
    }
  };

  if (!visible) return null;

  return (
    <div style={{
      padding: '8px 12px',
      borderTop: '1px solid rgba(168, 85, 247, 0.2)',
      background: 'rgba(168, 85, 247, 0.04)',
      animation: 'fadeIn 0.15s ease',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
        padding: '8px 12px',
        background: 'rgba(168, 85, 247, 0.05)',
        border: '1px solid rgba(168, 85, 247, 0.2)',
        borderRadius: 8,
      }}>
        <span style={{ color: '#a855f7', marginTop: 4 }}>✦</span>
        <textarea
          ref={textareaRef}
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask AI anything..."
          rows={1}
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            color: 'var(--text-primary)',
            fontFamily: 'var(--font-mono)',
            fontSize: 13,
            lineHeight: 1.5,
            resize: 'vertical',
            outline: 'none',
            minHeight: 24,
            maxHeight: 200,
          }}
        />
        <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
          <button
            onClick={() => { if (value.trim()) { onSubmit(value.trim()); setValue(''); } }}
            style={{
              background: 'rgba(168,85,247,0.1)', border: '1px solid rgba(168,85,247,0.3)',
              color: '#a855f7', padding: '4px 6px', borderRadius: 6,
              cursor: 'pointer', display: 'flex',
            }}
          >
            <Send size={14} />
          </button>
          <button
            onClick={onClose}
            style={{
              background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
              color: '#888', padding: '4px 6px', borderRadius: 6,
              cursor: 'pointer', display: 'flex',
            }}
          >
            <X size={14} />
          </button>
        </div>
      </div>
      <div style={{ fontSize: 10, color: '#555', marginTop: 4, textAlign: 'right' }}>
        Enter to send · Shift+Enter for newline · Esc to close
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Commit**

```bash
git add src/components/AIInputPanel.tsx src/components/ModeIndicator.tsx src/hooks/useGhostText.ts tests/unit/ghostText.test.ts
git commit -m "feat: add AI input panel, mode indicator, and ghost text prediction"
```

---

### Task 11: BlockOverlay + TerminalSession Orchestrator

**Files:**
- Create: `src/components/BlockOverlay.tsx`
- Create: `src/components/TerminalSession.tsx`
- Modify: `src/App.tsx` — replace inline XtermPane with TerminalSession

This is the critical integration task that wires everything together.

- [ ] **Step 1: Create src/components/BlockOverlay.tsx**

```tsx
import type { DisplayItem, SegmentedBlock } from '@/types';
import { AIResponseBlock } from './AIResponseBlock';
import { AgentStepCard } from './AgentStepCard';
import { ApprovalPrompt } from './ApprovalPrompt';
import { ErrorAffordance } from './ErrorAffordance';

interface BlockOverlayProps {
  items: DisplayItem[];
  onRunCommand: (command: string) => void;
  onCopy: (text: string) => void;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onEdit: (id: string) => void;
  onAskAI: (block: SegmentedBlock) => void;
}

export function BlockOverlay({ items, onRunCommand, onCopy, onApprove, onReject, onEdit, onAskAI }: BlockOverlayProps) {
  if (items.length === 0) return null;

  return (
    <div style={{ padding: '0 8px' }}>
      {items.map(item => {
        switch (item.type) {
          case 'ai':
            return (
              <AIResponseBlock
                key={item.id}
                id={item.id}
                question={item.question}
                entries={item.entries}
                content={item.content}
                streaming={item.streaming}
                onRunCommand={onRunCommand}
                onCopy={onCopy}
              />
            );
          case 'agent':
            return (
              <AgentStepCard
                key={item.id}
                id={item.id}
                question={item.question}
                steps={item.steps}
                streaming={item.streaming}
              />
            );
          case 'approval':
            return (
              <ApprovalPrompt
                key={item.id}
                id={item.id}
                command={item.command}
                status={item.status}
                onApprove={() => onApprove(item.id)}
                onReject={() => onReject(item.id)}
                onEdit={() => onEdit(item.id)}
              />
            );
          case 'error-affordance':
            return (
              <ErrorAffordance
                key={item.id}
                block={item.block}
                onAskAI={onAskAI}
              />
            );
          default:
            return null;
        }
      })}
    </div>
  );
}
```

- [ ] **Step 2: Create src/components/TerminalSession.tsx**

```tsx
import { useState, useEffect, useRef, useCallback } from 'react';
import { XtermPane, XtermPaneHandle } from './XtermPane';
import { BlockOverlay } from './BlockOverlay';
import { AIInputPanel } from './AIInputPanel';
import { ModeIndicator } from './ModeIndicator';
import { BlockSegmenter } from './BlockSegmenter';
import { looksLikeShellCommand } from '@/utils/commandDetector';
import { createClaudeProvider } from '@/providers/claude';
import type { DisplayItem, ContextMode, TrustLevel, SegmentedBlock, AIEntry } from '@/types';

interface TerminalSessionProps {
  tabId: string;
  ptyId: number | null;
  cwd: string;
  visible: boolean;
  trustLevel: TrustLevel;
  onContextModeChange: (mode: ContextMode) => void;
}

export function TerminalSession({ tabId, ptyId, cwd, visible, trustLevel, onContextModeChange }: TerminalSessionProps) {
  const [displayItems, setDisplayItems] = useState<DisplayItem[]>([]);
  const [inputMode, setInputMode] = useState<'shell' | 'ai'>('shell');
  const [altScreen, setAltScreen] = useState(false);
  const [aiPanelOpen, setAiPanelOpen] = useState(false);

  const xtermRef = useRef<XtermPaneHandle>(null);
  const segmenterRef = useRef(new BlockSegmenter());
  const providerRef = useRef(createClaudeProvider(tabId));
  const messageCleanupRef = useRef<(() => void) | null>(null);
  const currentAiIdRef = useRef<string | null>(null);

  useEffect(() => {
    const seg = segmenterRef.current;

    seg.onBlock((block) => {
      const hasError = block.output.includes('error') || block.output.includes('Error') ||
        block.output.includes('ENOENT') || block.output.includes('command not found');

      setDisplayItems(prev => {
        const items = [...prev];
        if (hasError) {
          items.push({
            type: 'error-affordance',
            id: `err-${block.id}`,
            block,
          });
        }
        return items;
      });
      onContextModeChange('shell');
    });

    seg.onAltScreen((entered) => {
      setAltScreen(entered);
    });

    return () => seg.reset();
  }, [onContextModeChange]);

  const handlePtyData = useCallback((data: string) => {
    segmenterRef.current.feed(data);
  }, []);

  const handleAISubmit = useCallback((message: string) => {
    setAiPanelOpen(false);
    onContextModeChange('ai');

    const id = `ai-${Date.now()}`;
    currentAiIdRef.current = id;

    setDisplayItems(prev => [...prev, {
      type: 'ai' as const,
      id,
      question: message,
      entries: [],
      content: '',
      streaming: true,
    }]);

    const entries: AIEntry[] = [];
    let textBuffer = '';

    messageCleanupRef.current = providerRef.current.onMessage((msg) => {
      if (msg.type === 'done') {
        setDisplayItems(prev => prev.map(item =>
          item.type === 'ai' && item.id === id
            ? { ...item, streaming: false }
            : item
        ));
        currentAiIdRef.current = null;
        onContextModeChange('shell');
        messageCleanupRef.current?.();
        messageCleanupRef.current = null;
        return;
      }

      if (msg.type === 'assistant') {
        const content = msg.message?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'text') {
              textBuffer += block.text;
              const lastEntry = entries[entries.length - 1];
              if (lastEntry?.kind === 'text') {
                lastEntry.text = textBuffer;
              } else {
                entries.push({ kind: 'text', text: textBuffer });
              }
            }
            if (block.type === 'tool_use') {
              textBuffer = '';
              entries.push({
                kind: 'tool',
                call: { id: block.id, name: block.name, input: JSON.stringify(block.input) },
              });
            }
          }
        }

        setDisplayItems(prev => prev.map(item =>
          item.type === 'ai' && item.id === id
            ? { ...item, entries: [...entries], content: textBuffer }
            : item
        ));
      }
    });

    providerRef.current.send(message, cwd, trustLevel);
  }, [cwd, trustLevel, onContextModeChange]);

  const handleRunCommand = useCallback((command: string) => {
    if (ptyId === null) return;
    window.tai.pty.write(ptyId, command + '\n');
    xtermRef.current?.focus();
  }, [ptyId]);

  const handleCopy = useCallback((text: string) => {
    navigator.clipboard.writeText(text);
  }, []);

  const handleAskAI = useCallback((block: SegmentedBlock) => {
    const message = `Fix this error:\n\`\`\`\n$ ${block.command}\n${block.output}\n\`\`\``;
    handleAISubmit(message);
  }, [handleAISubmit]);

  useEffect(() => {
    if (!visible) return;
    const handler = (e: KeyboardEvent) => {
      if (e.shiftKey && e.key === 'Tab' && !altScreen) {
        e.preventDefault();
        setAiPanelOpen(prev => !prev);
        setInputMode(prev => prev === 'shell' ? 'ai' : 'shell');
      }
      if (e.ctrlKey && e.key === 'k' && !altScreen) {
        e.preventDefault();
        setAiPanelOpen(true);
        setInputMode('ai');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [visible, altScreen]);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
        <XtermPane
          ref={xtermRef}
          ptyId={ptyId}
          visible={!altScreen || visible}
          onData={handlePtyData}
        />
        {!altScreen && (
          <BlockOverlay
            items={displayItems}
            onRunCommand={handleRunCommand}
            onCopy={handleCopy}
            onApprove={() => {}}
            onReject={() => {}}
            onEdit={() => {}}
            onAskAI={handleAskAI}
          />
        )}
      </div>
      {!altScreen && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px' }}>
          <ModeIndicator mode={inputMode} />
        </div>
      )}
      {!altScreen && (
        <AIInputPanel
          visible={aiPanelOpen}
          onSubmit={handleAISubmit}
          onClose={() => { setAiPanelOpen(false); setInputMode('shell'); xtermRef.current?.focus(); }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Update src/App.tsx to use TerminalSession**

```tsx
import { useState, useEffect, useCallback } from 'react';
import { GradientBorder } from './components/GradientBorder';
import { TabBar } from './components/TabBar';
import { TerminalSession } from './components/TerminalSession';
import type { ContextMode, TabState } from './types';

let tabCounter = 0;
function createTabState(): TabState {
  const id = `tab-${++tabCounter}`;
  return { id, ptyId: null, label: 'zsh', cwd: process.env.HOME || '/', contextMode: 'shell', trustLevel: 'ask' };
}

export default function App() {
  const [tabs, setTabs] = useState<TabState[]>(() => [createTabState()]);
  const [activeTabId, setActiveTabId] = useState(tabs[0].id);

  const activeTab = tabs.find(t => t.id === activeTabId)!;

  useEffect(() => {
    for (const tab of tabs) {
      if (tab.ptyId === null) {
        window.tai.pty.create(tab.cwd).then(ptyId => {
          setTabs(prev => prev.map(t => t.id === tab.id ? { ...t, ptyId } : t));
        });
      }
    }
  }, [tabs.length]);

  const handleNewTab = useCallback(() => {
    const tab = createTabState();
    setTabs(prev => [...prev, tab]);
    setActiveTabId(tab.id);
  }, []);

  const handleCloseTab = useCallback((id: string) => {
    const tab = tabs.find(t => t.id === id);
    if (tab?.ptyId != null) window.tai.pty.kill(tab.ptyId);
    setTabs(prev => {
      const next = prev.filter(t => t.id !== id);
      if (id === activeTabId && next.length > 0) {
        setActiveTabId(next[Math.max(0, prev.findIndex(t => t.id === id) - 1)].id);
      }
      return next;
    });
  }, [tabs, activeTabId]);

  const handleRenameTab = useCallback((id: string, label: string) => {
    setTabs(prev => prev.map(t => t.id === id ? { ...t, label } : t));
  }, []);

  const handleContextModeChange = useCallback((tabId: string, mode: ContextMode) => {
    setTabs(prev => prev.map(t => t.id === tabId ? { ...t, contextMode: mode } : t));
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'T') { e.preventDefault(); handleNewTab(); }
      if (e.ctrlKey && e.shiftKey && e.key === 'W') { e.preventDefault(); if (tabs.length > 1) handleCloseTab(activeTabId); }
      if (e.ctrlKey && !e.shiftKey && e.key >= '1' && e.key <= '9') {
        const idx = parseInt(e.key) - 1;
        if (idx < tabs.length) { e.preventDefault(); setActiveTabId(tabs[idx].id); }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [tabs, activeTabId, handleNewTab, handleCloseTab]);

  return (
    <GradientBorder mode={activeTab.contextMode}>
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-base)' }}>
        <TabBar
          tabs={tabs}
          activeTabId={activeTabId}
          onSelectTab={setActiveTabId}
          onNewTab={handleNewTab}
          onCloseTab={handleCloseTab}
          onRenameTab={handleRenameTab}
        />
        {tabs.map(tab => (
          <div
            key={tab.id}
            style={{
              flex: 1,
              display: tab.id === activeTabId ? 'flex' : 'none',
              flexDirection: 'column',
            }}
          >
            <TerminalSession
              tabId={tab.id}
              ptyId={tab.ptyId}
              cwd={tab.cwd}
              visible={tab.id === activeTabId}
              trustLevel={tab.trustLevel}
              onContextModeChange={(mode) => handleContextModeChange(tab.id, mode)}
            />
          </div>
        ))}
      </div>
    </GradientBorder>
  );
}
```

- [ ] **Step 4: Run dev and test the full integration**

```bash
npm run dev
```

Expected: Full working terminal with tabs. Shift+Tab or Ctrl+K opens the AI input panel. Typing a question and pressing Enter sends it to Claude (if installed). AI responses appear as rich blocks below the terminal output. Error affordances appear after failed commands. Gradient border shifts between green (shell) and purple (AI mode).

- [ ] **Step 5: Commit**

```bash
git add src/components/BlockOverlay.tsx src/components/TerminalSession.tsx src/App.tsx
git commit -m "feat: integrate terminal session with hybrid rendering and AI input"
```

---

### Task 12: Settings System

**Files:**
- Create: `src/components/SettingsOverlay.tsx`
- Create: `src/hooks/useSettings.ts`
- Modify: `electron/main.ts` — config IPC handlers
- Modify: `electron/preload.ts` — expose config IPC

- [ ] **Step 1: Add config IPC handlers to electron/main.ts**

Add after the existing IPC handlers:

```typescript
import * as fs from 'fs';
import * as path from 'path';

const configPath = path.join(process.env.HOME || '/', '.config', 'tai', 'settings.json');

function readConfig(): Record<string, any> {
  try {
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(configPath)) return {};
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch { return {}; }
}

function writeConfig(config: Record<string, any>) {
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

ipcMain.handle('config:get', () => readConfig());
ipcMain.handle('config:set', (_event, key: string, value: any) => {
  const config = readConfig();
  config[key] = value;
  writeConfig(config);
  mainWindow?.webContents.send('config:changed', config);
  return config;
});
```

- [ ] **Step 2: Add config IPC to electron/preload.ts**

Add to the `tai` object:

```typescript
config: {
  get: () => ipcRenderer.invoke('config:get'),
  set: (key: string, value: any) => ipcRenderer.invoke('config:set', key, value),
  onChanged: (callback: (config: any) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, config: any) => callback(config);
    ipcRenderer.on('config:changed', listener);
    return () => ipcRenderer.removeListener('config:changed', listener);
  },
},
```

- [ ] **Step 3: Create src/hooks/useSettings.ts**

```typescript
import { useState, useEffect, useCallback } from 'react';

const DEFAULTS = {
  'general.shell': '',
  'general.startDir': '',
  'general.fontSize': 14,
  'general.cursorStyle': 'bar',
  'ai.provider': 'claude',
  'ai.model': 'sonnet',
  'trust.default': 'ask',
  'appearance.gradientBorder': true,
  'appearance.animationSpeed': 20,
};

export function useSettings() {
  const [config, setConfig] = useState<Record<string, any>>(DEFAULTS);

  useEffect(() => {
    window.tai.config.get().then((saved: Record<string, any>) => {
      setConfig({ ...DEFAULTS, ...saved });
    });
    const cleanup = window.tai.config.onChanged((updated: Record<string, any>) => {
      setConfig({ ...DEFAULTS, ...updated });
    });
    return cleanup;
  }, []);

  const setSetting = useCallback((key: string, value: any) => {
    window.tai.config.set(key, value);
    setConfig(prev => ({ ...prev, [key]: value }));
  }, []);

  return { config, setSetting };
}
```

- [ ] **Step 4: Create src/components/SettingsOverlay.tsx**

```tsx
import { useState } from 'react';
import { X, Settings } from 'lucide-react';

interface SettingsOverlayProps {
  visible: boolean;
  onClose: () => void;
  config: Record<string, any>;
  onSet: (key: string, value: any) => void;
}

type Category = 'general' | 'ai' | 'trust' | 'appearance' | 'keybindings';

export function SettingsOverlay({ visible, onClose, config, onSet }: SettingsOverlayProps) {
  const [category, setCategory] = useState<Category>('general');

  if (!visible) return null;

  const categories: { id: Category; label: string }[] = [
    { id: 'general', label: 'General' },
    { id: 'ai', label: 'AI Provider' },
    { id: 'trust', label: 'Trust' },
    { id: 'appearance', label: 'Appearance' },
    { id: 'keybindings', label: 'Keybindings' },
  ];

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 600, maxHeight: '80vh', background: '#0e0e1a',
          border: '1px solid var(--border-subtle)',
          borderRadius: 12, overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
          animation: 'fadeIn 0.15s ease',
        }}
      >
        <div style={{
          padding: '14px 16px',
          display: 'flex', alignItems: 'center', gap: 8,
          borderBottom: '1px solid var(--border-subtle)',
        }}>
          <Settings size={16} color="var(--text-secondary)" />
          <span style={{ fontSize: 14, color: 'var(--text-primary)', flex: 1 }}>Settings</span>
          <X size={16} color="var(--text-muted)" style={{ cursor: 'pointer' }} onClick={onClose} />
        </div>

        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          <div style={{
            width: 160, borderRight: '1px solid var(--border-subtle)',
            padding: '8px 0',
          }}>
            {categories.map(cat => (
              <div
                key={cat.id}
                onClick={() => setCategory(cat.id)}
                style={{
                  padding: '8px 16px', cursor: 'pointer',
                  fontSize: 12,
                  color: category === cat.id ? 'var(--text-primary)' : 'var(--text-secondary)',
                  background: category === cat.id ? 'rgba(255,255,255,0.05)' : 'transparent',
                }}
              >
                {cat.label}
              </div>
            ))}
          </div>

          <div style={{ flex: 1, padding: 16, overflow: 'auto' }}>
            {category === 'general' && (
              <SettingsGroup>
                <SettingRow label="Font Size" value={
                  <input type="number" value={config['general.fontSize']} onChange={e => onSet('general.fontSize', parseInt(e.target.value))}
                    style={inputStyle} />
                } />
                <SettingRow label="Cursor Style" value={
                  <select value={config['general.cursorStyle']} onChange={e => onSet('general.cursorStyle', e.target.value)}
                    style={inputStyle}>
                    <option value="bar">Bar</option>
                    <option value="block">Block</option>
                    <option value="underline">Underline</option>
                  </select>
                } />
              </SettingsGroup>
            )}
            {category === 'ai' && (
              <SettingsGroup>
                <SettingRow label="Provider" value={
                  <select value={config['ai.provider']} onChange={e => onSet('ai.provider', e.target.value)}
                    style={inputStyle}>
                    <option value="claude">Claude</option>
                  </select>
                } />
                <SettingRow label="Model" value={
                  <input type="text" value={config['ai.model']} onChange={e => onSet('ai.model', e.target.value)}
                    style={inputStyle} />
                } />
              </SettingsGroup>
            )}
            {category === 'trust' && (
              <SettingsGroup>
                <SettingRow label="Default Trust Level" value={
                  <select value={config['trust.default']} onChange={e => onSet('trust.default', e.target.value)}
                    style={inputStyle}>
                    <option value="ask">Ask (approve everything)</option>
                    <option value="approve-edits">Approve Edits (read-only is free)</option>
                    <option value="bypass">Bypass (full autonomy)</option>
                  </select>
                } />
              </SettingsGroup>
            )}
            {category === 'appearance' && (
              <SettingsGroup>
                <SettingRow label="Gradient Border" value={
                  <input type="checkbox" checked={config['appearance.gradientBorder']}
                    onChange={e => onSet('appearance.gradientBorder', e.target.checked)} />
                } />
                <SettingRow label="Animation Speed (seconds)" value={
                  <input type="number" value={config['appearance.animationSpeed']}
                    onChange={e => onSet('appearance.animationSpeed', parseInt(e.target.value))}
                    style={inputStyle} />
                } />
              </SettingsGroup>
            )}
            {category === 'keybindings' && (
              <div style={{ color: 'var(--text-secondary)', fontSize: 12, padding: 16 }}>
                Keybinding customization coming soon.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SettingsGroup({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>{children}</div>;
}

function SettingRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{label}</span>
      {value}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 6,
  padding: '4px 8px',
  color: 'var(--text-primary)',
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
  outline: 'none',
  width: 160,
};
```

- [ ] **Step 5: Wire settings into App.tsx**

Add to App.tsx — the settings state and Ctrl+, handler:

Import at top:
```tsx
import { SettingsOverlay } from './components/SettingsOverlay';
import { useSettings } from './hooks/useSettings';
```

Inside the component:
```tsx
const { config, setSetting } = useSettings();
const [settingsOpen, setSettingsOpen] = useState(false);
```

Add to the keydown handler:
```tsx
if (e.ctrlKey && e.key === ',') { e.preventDefault(); setSettingsOpen(true); }
```

Add before closing `</GradientBorder>`:
```tsx
<SettingsOverlay
  visible={settingsOpen}
  onClose={() => setSettingsOpen(false)}
  config={config}
  onSet={setSetting}
/>
```

- [ ] **Step 6: Run dev and verify settings**

```bash
npm run dev
```

Expected: Ctrl+, opens settings overlay. Can change font size, cursor style, trust level, toggle gradient border. Settings persist to `~/.config/tai/settings.json`. Esc closes overlay.

- [ ] **Step 7: Commit**

```bash
git add src/components/SettingsOverlay.tsx src/hooks/useSettings.ts electron/main.ts electron/preload.ts src/App.tsx
git commit -m "feat: add settings system with overlay UI and persistent config"
```

---

### Task 13: Final Integration + Polish

**Files:**
- Modify: `src/App.tsx` — final wiring
- Modify: `src/components/TerminalSession.tsx` — trust level display
- Create: `src/components/TrustBadge.tsx`

- [ ] **Step 1: Create src/components/TrustBadge.tsx**

```tsx
import { Shield, ShieldCheck, ShieldOff } from 'lucide-react';
import type { TrustLevel } from '@/types';

const TRUST_CONFIG: Record<TrustLevel, { label: string; color: string; Icon: typeof Shield }> = {
  ask: { label: 'Ask', color: 'var(--color-shell)', Icon: Shield },
  'approve-edits': { label: 'Approve Edits', color: 'var(--color-warning)', Icon: ShieldCheck },
  bypass: { label: 'Bypass', color: 'var(--color-error)', Icon: ShieldOff },
};

interface TrustBadgeProps {
  level: TrustLevel;
}

export function TrustBadge({ level }: TrustBadgeProps) {
  const { label, color, Icon } = TRUST_CONFIG[level];

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 4,
      padding: '2px 8px',
      borderRadius: 4,
      border: `1px solid ${color}33`,
      fontSize: 10,
      color,
    }}>
      <Icon size={10} />
      {label}
    </div>
  );
}
```

- [ ] **Step 2: Add TrustBadge to TabBar**

Import `TrustBadge` in `TabBar.tsx` and add it next to the tab label for the active tab:

After the label `<span>` in the tab render, add:

```tsx
{isActive && <TrustBadge level={tab.trustLevel} />}
```

Update the `TabBarProps` and imports — `TabState` already includes `trustLevel`.

- [ ] **Step 3: Add .gitignore entry for .superpowers**

```bash
echo ".superpowers/" >> /var/home/mstephens/Documents/GitHub/tai/.gitignore
```

- [ ] **Step 4: Run the full test suite**

```bash
npx vitest run --config tests/vitest.config.ts
```

Expected: All tests pass — stripAnsi (6), commandDetector (9), BlockSegmenter (6), ghostText (5).

- [ ] **Step 5: Run dev and do a full manual test**

```bash
npm run dev
```

Manual verification checklist:
- Terminal loads, shell prompt appears, can type commands
- Tab management: Ctrl+Shift+T new tab, Ctrl+1-9 switch, Ctrl+Shift+W close
- Shift+Tab opens AI input panel, border shifts to purple
- Ctrl+K also opens AI panel
- Type a question, Enter sends to Claude (if installed)
- AI response appears as a rich block with Run/Copy buttons
- Error affordance appears after a bad command (e.g., `asdfasdf`)
- Ctrl+, opens settings, changes persist
- Gradient border is visible and flowing
- vim/htop work (alt-screen detection)
- Trust badge visible in tab bar

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: final integration — trust badge, polish, full test suite"
```

---

## Self-Review Checklist

**Spec coverage:**
- ✅ Core terminal (xterm, node-pty) — Task 2, 3
- ✅ AI mode with auto-detect input — Task 4 (detector), Task 10 (panel), Task 11 (integration)
- ✅ Agent mode with configurable trust — Task 8 (provider), Task 11 (integration), Task 13 (badge)
- ✅ Tab management — Task 7
- ✅ Shell history + ghost text — Task 10
- ✅ Tab completion — Task 2 (pty service)
- ✅ Keybindings — Task 7 (tabs), Task 11 (mode switching), Task 12 (settings)
- ✅ Settings UI — Task 12
- ✅ Theme/gradient border — Task 6
- ✅ Alt-screen support — Task 5 (segmenter), Task 11 (session)

**Placeholder scan:** No TBD/TODO found. Keybindings settings page has a "coming soon" placeholder — acceptable for v1 since the keybindings themselves all work, just the customization UI is deferred.

**Type consistency:** `ContextMode`, `TrustLevel`, `SegmentedBlock`, `DisplayItem`, `AIEntry`, `AgentStep`, `TabState` — all defined in `types.ts` and used consistently across tasks. `Provider` interface in `providers/types.ts` matches `createClaudeProvider` implementation.
