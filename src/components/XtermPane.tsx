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
