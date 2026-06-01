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
  /**
   * When provided, the xterm DOM container is imperatively re-parented into
   * this element. Used to relocate the xterm into the active card while
   * keeping the xterm.js Terminal instance alive (no dispose/recreate).
   * When the host element changes, only the DOM parent moves; React keeps
   * this component mounted, so xterm's buffer state is preserved.
   */
  hostEl?: HTMLElement | null;
}

export const HiddenXterm = forwardRef<HiddenXtermHandle, HiddenXtermProps>(
  function HiddenXterm({ ptyId, visible, onData, hostEl }, ref) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    if (containerRef.current === null && typeof document !== 'undefined') {
      const el = document.createElement('div');
      el.style.position = 'relative';
      el.style.flex = '1';
      el.style.minHeight = '0';
      el.style.overflow = 'hidden';
      el.style.width = '100%';
      el.style.height = '100%';
      containerRef.current = el;
    }
    const xtermRef = useRef<Terminal | null>(null);
    const fitRef = useRef<FitAddon | null>(null);

    useEffect(() => {
      if (!containerRef.current) return;
      // Ensure the container is attached to the document before xterm.open,
      // otherwise xterm cannot measure cell dimensions. Use hostEl if provided,
      // else attach to body temporarily (the host-reparenting effect will move
      // it as soon as a real host is available).
      if (!containerRef.current.parentElement) {
        (hostEl ?? document.body).appendChild(containerRef.current);
      }

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
        const el = containerRef.current;
        if (el && el.parentElement) {
          el.parentElement.removeChild(el);
        }
      };
    }, [ptyId]);

    useEffect(() => {
      if (visible && fitRef.current && containerRef.current) {
        // Two passes (rAF + 150ms) to survive layout settling after a DOM move
        // into the active card. Explicit refresh() repaints buffer content that
        // was written while the parent was 0x0 (e.g. the hidden fallback host).
        const doFit = () => {
          try {
            fitRef.current?.fit();
            if (xtermRef.current) {
              window.tai?.pty?.resize(ptyId, xtermRef.current.cols, xtermRef.current.rows);
              xtermRef.current.refresh(0, xtermRef.current.rows - 1);
              xtermRef.current.focus();
            }
          } catch { /* ignore */ }
        };
        const raf = requestAnimationFrame(doFit);
        const t = setTimeout(doFit, 150);
        return () => {
          cancelAnimationFrame(raf);
          clearTimeout(t);
        };
      }
    }, [visible, ptyId]);

    useEffect(() => {
      if (!containerRef.current) return;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const observer = new ResizeObserver(() => {
        if (!visible) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          timer = null;
          try {
            fitRef.current?.fit();
            if (xtermRef.current) {
              window.tai?.pty?.resize(ptyId, xtermRef.current.cols, xtermRef.current.rows);
            }
          } catch { /* ignore */ }
        }, 50);
      });
      observer.observe(containerRef.current);
      return () => {
        observer.disconnect();
        if (timer) clearTimeout(timer);
      };
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

    const pendingAckRef = useRef(0);
    const ackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const scheduleAck = () => {
      if (ackTimerRef.current) return;
      ackTimerRef.current = setTimeout(() => {
        ackTimerRef.current = null;
        const n = pendingAckRef.current;
        pendingAckRef.current = 0;
        if (n > 0) window.tai?.pty?.dataAck?.(ptyId, n);
      }, 0);
    };

    useImperativeHandle(ref, () => ({
      write(data: string) {
        const term = xtermRef.current;
        if (!term) {
          onData?.(data);
          return;
        }
        term.write(data, () => {
          pendingAckRef.current += data.length;
          scheduleAck();
        });
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

    useEffect(() => {
      return () => {
        if (ackTimerRef.current) clearTimeout(ackTimerRef.current);
      };
    }, []);

    // Apply visibility styles imperatively to the imperative container.
    useEffect(() => {
      const el = containerRef.current;
      if (!el) return;
      if (visible) {
        el.style.visibility = '';
        el.style.pointerEvents = '';
        el.style.position = 'relative';
        el.style.inset = '';
        el.style.flex = '1';
        el.style.width = '100%';
        el.style.height = '100%';
      } else {
        el.style.position = 'absolute';
        el.style.inset = '0';
        el.style.visibility = 'hidden';
        el.style.pointerEvents = 'none';
      }
    }, [visible]);

    // Click-to-focus.
    useEffect(() => {
      const el = containerRef.current;
      if (!el) return;
      const onClick = () => {
        if (visible) xtermRef.current?.focus();
      };
      el.addEventListener('click', onClick);
      return () => el.removeEventListener('click', onClick);
    }, [visible]);

    // Re-parent the xterm container into the requested host element.
    // Crucially, this is a DOM move (not a React unmount), so xterm.js never
    // notices and its buffer/render state is preserved.
    useEffect(() => {
      const el = containerRef.current;
      if (!el || !hostEl) return;
      if (el.parentElement !== hostEl) {
        hostEl.appendChild(el);
      }
      if (!visible || !fitRef.current) return;
      const doFit = () => {
        try {
          fitRef.current?.fit();
          if (xtermRef.current) {
            window.tai?.pty?.resize(ptyId, xtermRef.current.cols, xtermRef.current.rows);
            xtermRef.current.refresh(0, xtermRef.current.rows - 1);
          }
        } catch { /* ignore */ }
      };
      const raf = requestAnimationFrame(doFit);
      const t = setTimeout(doFit, 150);
      return () => {
        cancelAnimationFrame(raf);
        clearTimeout(t);
      };
    }, [hostEl, ptyId, visible]);

    // This component doesn't render any React-owned DOM; the xterm container
    // is imperative and lives wherever hostEl points to.
    return null;
  }
);
