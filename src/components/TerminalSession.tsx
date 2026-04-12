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
