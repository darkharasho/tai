import { useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

export interface HiddenXtermHandle {
  write: (data: string) => void;
  sendInput: (data: string) => void;
  getTerminal: () => Terminal | null;
  focus: () => void;
  clear: () => void;
  getBufferContent: () => string;
}

interface HiddenXtermProps {
  ptyId: number;
  visible: boolean;
  onData?: (data: string) => void;
}

export const HiddenXterm = forwardRef<HiddenXtermHandle, HiddenXtermProps>(
  function HiddenXterm({ ptyId, visible, onData }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const xtermRef = useRef<Terminal | null>(null);
    const fitRef = useRef<FitAddon | null>(null);

    useEffect(() => {
      if (!containerRef.current) return;

      const xterm = new Terminal({
        theme: {
          background: '#0c0f11',
          foreground: '#bec6d0',
          cursor: '#bec6d0',
          cursorAccent: '#0c0f11',
          selectionBackground: 'rgba(168, 95, 241, 0.3)',
          black: '#0c0f11',
          red: '#E35535',
          green: '#00a884',
          yellow: '#c7910c',
          blue: '#11B7D4',
          magenta: '#d46ec0',
          cyan: '#38c7bd',
          white: '#bec6d0',
          brightBlack: '#5a6a7a',
          brightRed: '#E35535',
          brightGreen: '#00a884',
          brightYellow: '#f5b832',
          brightBlue: '#11B7D4',
          brightMagenta: '#a85ff1',
          brightCyan: '#38c7bd',
          brightWhite: '#ffffff',
        },
        fontFamily: "'Fira Code', 'Cascadia Code', 'JetBrains Mono', 'Source Code Pro', 'Symbols Nerd Font Mono', monospace",
        fontSize: 13,
        lineHeight: 1.3,
        cursorBlink: true,
        scrollback: 10000,
        convertEol: true,
      });

      const fit = new FitAddon();
      xterm.loadAddon(fit);
      xterm.open(containerRef.current);

      xterm.attachCustomKeyEventHandler(() => true);

      xterm.onData((data) => {
        window.tai?.pty?.write(ptyId, data);
      });

      xtermRef.current = xterm;
      fitRef.current = fit;

      return () => {
        xterm.dispose();
        xtermRef.current = null;
        fitRef.current = null;
      };
    }, [ptyId]);

    useEffect(() => {
      if (visible && fitRef.current && containerRef.current) {
        const timer = setTimeout(() => {
          try {
            fitRef.current?.fit();
            if (xtermRef.current) {
              window.tai?.pty?.resize(ptyId, xtermRef.current.cols, xtermRef.current.rows);
              xtermRef.current.focus();
            }
          } catch { /* ignore */ }
        }, 50);
        return () => clearTimeout(timer);
      }
    }, [visible, ptyId]);

    useEffect(() => {
      if (!containerRef.current) return;
      const observer = new ResizeObserver(() => {
        if (!visible) return;
        requestAnimationFrame(() => {
          try {
            fitRef.current?.fit();
            if (xtermRef.current) {
              window.tai?.pty?.resize(ptyId, xtermRef.current.cols, xtermRef.current.rows);
            }
          } catch { /* ignore */ }
        });
      });
      observer.observe(containerRef.current);
      return () => observer.disconnect();
    }, [ptyId, visible]);

    useEffect(() => {
      const onWindowFocus = () => xtermRef.current?.focus();
      const onWindowBlur = () => xtermRef.current?.blur();
      window.addEventListener('focus', onWindowFocus);
      window.addEventListener('blur', onWindowBlur);
      return () => {
        window.removeEventListener('focus', onWindowFocus);
        window.removeEventListener('blur', onWindowBlur);
      };
    }, []);

    useImperativeHandle(ref, () => ({
      write(data: string) {
        xtermRef.current?.write(data);
        onData?.(data);
      },
      sendInput(data: string) {
        window.tai?.pty?.write(ptyId, data);
      },
      getTerminal() {
        return xtermRef.current;
      },
      focus() {
        xtermRef.current?.focus();
      },
      clear() {
        xtermRef.current?.clear();
      },
      getBufferContent() {
        const term = xtermRef.current;
        if (!term) return '';
        const buf = term.buffer.active;
        const lines: string[] = [];
        for (let i = 0; i < buf.length; i++) {
          const line = buf.getLine(i);
          if (line) lines.push(line.translateToString(true));
        }
        let end = lines.length;
        while (end > 0 && lines[end - 1].trim() === '') end--;
        let start = 0;
        while (start < end && lines[start].trim() === '') start++;
        return lines.slice(start, end).join('\n');
      },
    }), [ptyId, onData]);

    const style: React.CSSProperties = visible
      ? {
          position: 'relative',
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
        }
      : {
          position: 'absolute',
          inset: 0,
          visibility: 'hidden',
          pointerEvents: 'none',
          overflow: 'hidden',
        };

    return (
      <div
        ref={containerRef}
        onClick={() => visible && xtermRef.current?.focus()}
        style={style}
      />
    );
  }
);
