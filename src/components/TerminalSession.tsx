import { useState, useRef, useEffect, useCallback } from 'react';
import { HiddenXterm } from './HiddenXterm';
import type { HiddenXtermHandle } from './HiddenXterm';
import { BlockList } from './BlockList';
import type { DisplayItem } from './BlockList';
import { TerminalInput } from './TerminalInput';
import type { TerminalInputHandle } from './TerminalInput';
import { BlockSegmenter } from './BlockSegmenter';
import { createClaudeProvider } from '@/providers/claude';
import type { ContextMode, TrustLevel, AIEntry } from '@/types';

interface TerminalSessionProps {
  tabId: string;
  ptyId: number | null;
  cwd: string;
  visible: boolean;
  trustLevel: TrustLevel;
  onContextModeChange: (mode: ContextMode) => void;
  onRemoteChange: (isRemote: boolean, sshTarget: string | null) => void;
}

function nextBlockId(): string {
  return `tm-${crypto.randomUUID()}`;
}

export function TerminalSession({ tabId, ptyId, cwd: initialCwd, visible, trustLevel, onContextModeChange, onRemoteChange }: TerminalSessionProps) {
  const [displayItems, setDisplayItems] = useState<DisplayItem[]>([]);
  const [altScreenVisible, setAltScreenVisible] = useState(false);
  const [inputMode, setInputMode] = useState<'shell' | 'ai'>('shell');
  const handleInputModeChange = useCallback((mode: 'shell' | 'ai') => {
    setInputMode(mode);
    onContextModeChange(mode);
  }, [onContextModeChange]);
  const [cwd, setCwd] = useState(initialCwd);
  const [promptInfo, setPromptInfo] = useState<{ text: string; isRemote: boolean; sshTarget?: string } | null>(null);
  const [shellHistory, setShellHistory] = useState<string[]>([]);
  const [awaitingInput, setAwaitingInput] = useState(false);
  const [editValue, setEditValue] = useState<string | undefined>(undefined);

  const segmenterRef = useRef(new BlockSegmenter());
  const hiddenXtermRef = useRef<HiddenXtermHandle>(null);
  const inputRef = useRef<TerminalInputHandle>(null);
  const providerRef = useRef(createClaudeProvider(tabId));
  const aiCleanupRef = useRef<(() => void) | null>(null);
  const aiBlockIdRef = useRef<string | null>(null);
  const aiSuggestedCommands = useRef<Set<string>>(new Set());
  const pendingCommandRef = useRef<{ command: string; startTime: number } | null>(null);
  const altScreenRef = useRef(false);
  const preambleSentRef = useRef(false);
  altScreenRef.current = altScreenVisible;

  useEffect(() => {
    if (initialCwd) setCwd(initialCwd);
  }, [initialCwd]);

  useEffect(() => {
    window.tai?.pty?.getShellHistory(500).then((lines: string[]) => setShellHistory(lines));
  }, []);

  useEffect(() => {
    window.tai?.system?.getHostname().then((name: string) => {
      if (name) segmenterRef.current.setLocalHostname(name);
    });
  }, []);

  useEffect(() => {
    if (visible) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [visible]);

  const refreshCwd = useCallback(async (id: number) => {
    try {
      const dir = await window.tai?.pty?.getCwd(id);
      if (dir) setCwd(dir);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    const hasPending = displayItems.some(item => item.type === 'command' && item.active);
    if (!hasPending) {
      if (awaitingInput) setAwaitingInput(false);
      return;
    }

    let cancelled = false;
    const poll = async () => {
      if (cancelled || ptyId === null) return;
      try {
        const awaiting = await window.tai?.pty?.isAwaitingInput(ptyId);
        if (!cancelled) setAwaitingInput(!!awaiting);
      } catch { /* ignore */ }
    };
    poll();
    const interval = setInterval(poll, 1500);
    return () => { cancelled = true; clearInterval(interval); };
  }, [displayItems.some(item => item.type === 'command' && item.active), ptyId]);

  useEffect(() => {
    if (ptyId === null) return;
    let cancelled = false;
    const segmenter = segmenterRef.current;

    segmenter.onBlock((block) => {
      if (cancelled) return;
      const pending = pendingCommandRef.current;
      pendingCommandRef.current = null;
      const fixedBlock = pending
        ? { ...block, command: pending.command, duration: Date.now() - pending.startTime }
        : block;
      const isSuggested = aiSuggestedCommands.current.has(fixedBlock.command);
      if (isSuggested) aiSuggestedCommands.current.delete(fixedBlock.command);
      setDisplayItems(prev => {
        if (pending) {
          const idx = prev.findIndex(item => item.type === 'command' && item.block.id === 'pending');
          if (idx !== -1) {
            const next = [...prev];
            next[idx] = { type: 'command', block: fixedBlock, aiSuggested: isSuggested };
            return next;
          }
        }
        return [...prev, { type: 'command', block: fixedBlock, aiSuggested: isSuggested }];
      });
      refreshCwd(ptyId);
    });

    let outputRafId: number | null = null;
    let latestOutput: { clean: string; raw: string } | null = null;
    segmenter.onOutput((output, rawOutput) => {
      if (cancelled) return;
      if (!pendingCommandRef.current) return;
      latestOutput = { clean: output, raw: rawOutput };
      if (outputRafId !== null) return;
      outputRafId = requestAnimationFrame(() => {
        outputRafId = null;
        const current = latestOutput;
        if (current === null) return;
        latestOutput = null;
        setDisplayItems(prev => {
          const idx = prev.findIndex(item => item.type === 'command' && item.block.id === 'pending');
          if (idx === -1) return prev;
          const next = [...prev];
          const item = next[idx];
          if (item.type === 'command') {
            next[idx] = { ...item, block: { ...item.block, output: current.clean, rawOutput: current.raw } };
          }
          return next;
        });
      });
    });

    segmenter.onAltScreen((entered) => {
      if (cancelled) return;
      setAltScreenVisible(entered);
    });

    segmenter.onPromptChange((prompt, isRemote, sshTarget) => {
      if (cancelled) return;
      setPromptInfo({ text: prompt, isRemote, sshTarget: sshTarget ?? undefined });
      onRemoteChange(isRemote, sshTarget);
    });

    const cleanupData = window.tai?.pty?.onData((id: number, data: string) => {
      if (cancelled) return;
      if (id !== ptyId) return;
      if (hiddenXtermRef.current) {
        hiddenXtermRef.current.write(data);
      } else {
        segmenterRef.current.feed(data);
      }
    });

    return () => {
      cancelled = true;
      cleanupData?.();
      if (outputRafId !== null) cancelAnimationFrame(outputRafId);
      segmenter.reset();
    };
  }, [ptyId, refreshCwd]);

  const executeCommand = useCallback((command: string) => {
    if (ptyId === null) return;
    segmenterRef.current.bootstrapPrompt();
    window.tai?.pty?.write(ptyId, command + '\n');
  }, [ptyId]);

  const handleSubmit = useCallback((value: string) => {
    if (inputMode === 'shell') {
      const pendingBlock = {
        id: 'pending',
        command: value,
        output: '',
        rawOutput: '',
        promptText: '',
        startTime: Date.now(),
        duration: 0,
        isRemote: false,
      };
      pendingCommandRef.current = { command: value, startTime: Date.now() };
      setDisplayItems(prev => {
        const cleaned = prev.map(item =>
          item.type === 'command' && item.block.id === 'pending'
            ? { ...item, active: false, block: { ...item.block, id: `stale-${Date.now()}` } }
            : item
        );
        return [...cleaned, { type: 'command' as const, block: pendingBlock, active: true }];
      });
      executeCommand(value);
      setEditValue(undefined);
    } else {
      handleAIRequest(value);
    }
  }, [inputMode, executeCommand]);

  const handleAIRequest = useCallback((prompt: string) => {
    handleInputModeChange('ai');
    const aiId = nextBlockId();
    const aiStartTime = Date.now();
    let gotContent = false;

    setDisplayItems(prev => [...prev,
      { type: 'ai' as const, id: aiId, question: prompt, content: '', suggestedCommands: [], streaming: true },
    ]);

    const finalize = () => {
      setDisplayItems(prev => {
        const aiItem = prev.find((item): item is DisplayItem & { type: 'ai' } => item.type === 'ai' && item.id === aiId);
        if (!aiItem || aiItem.type !== 'ai') return prev;
        const bashMatches = [...aiItem.content.matchAll(/```(?:bash|sh|shell)\n([\s\S]*?)```/g)];
        if (bashMatches.length === 0) return prev;
        const commands = bashMatches.map(m => m[1].trim());
        return prev.map(item =>
          item.type === 'ai' && item.id === aiId
            ? { ...item, suggestedCommands: commands }
            : item
        );
      });
    };

    let entries: AIEntry[] = [];
    let knownToolIds = new Set<string>();
    let lastTextEntry = '';
    let currentAiId = aiId;
    let needsNewBlock = false;

    const updateItem = () => {
      const contentParts = entries.filter(e => e.kind === 'text').map(e => e.text);
      const content = contentParts.join('\n\n');
      const entriesSnapshot = [...entries];
      setDisplayItems(prev => prev.map(item =>
        item.type === 'ai' && item.id === currentAiId
          ? { ...item, content, entries: entriesSnapshot }
          : item
      ));
    };

    let fullPrompt = prompt;
    if (!preambleSentRef.current) {
      preambleSentRef.current = true;
      const preamble = [
        'You are a general-purpose AI terminal assistant.',
        '',
        'Your default mode is as a system-wide helper:',
        '- Answer general questions (tech, trivia, how-tos, troubleshooting, etc.)',
        '- Help with shell commands, system administration, networking, file management',
        '',
        'When the user asks about code or development tasks, shift into developer mode:',
        '- Use tools (Bash, Read, Write, Edit) to actually do the work rather than just explaining',
        '- Run commands yourself instead of just suggesting them',
        '',
        'General guidelines:',
        '- Be concise and direct. Lead with the answer or action.',
        '- When showing commands, use ```bash code blocks.',
        '- Skip pleasantries and unnecessary explanation.',
        `- Working directory: ${cwd}`,
      ].join('\n');
      fullPrompt = `<system>\n${preamble}\n</system>\n\n${prompt}`;
    }

    const cleanup = providerRef.current.onMessage((msg: any) => {
      if (msg.type === 'user' && msg.message?.content) {
        const content = Array.isArray(msg.message.content) ? msg.message.content : [];
        for (const block of content) {
          if (block.type === 'tool_result' && block.tool_use_id) {
            const output = typeof block.content === 'string'
              ? block.content
              : Array.isArray(block.content)
                ? block.content.map((c: any) => c.text || '').join('')
                : '';
            const toolEntry = entries.find(
              e => e.kind === 'tool' && e.call?.id === block.tool_use_id
            );
            if (toolEntry && toolEntry.kind === 'tool' && toolEntry.call) {
              toolEntry.call.output = output;
              toolEntry.call.error = block.is_error ? output : undefined;
              updateItem();
            }
          }
        }
      }

      if (msg.type === 'assistant' && msg.message?.content) {
        if (needsNewBlock) {
          needsNewBlock = false;
          currentAiId = nextBlockId();
          entries = [];
          knownToolIds = new Set<string>();
          lastTextEntry = '';
          setDisplayItems(prev => [...prev, {
            type: 'ai' as const,
            id: currentAiId,
            question: '',
            content: '',
            suggestedCommands: [],
            streaming: true,
          }]);
          aiBlockIdRef.current = currentAiId;
        }

        const contentBlocks = Array.isArray(msg.message.content) ? msg.message.content : [];
        let hasNewData = false;

        const textParts: string[] = [];
        for (const block of contentBlocks) {
          if (block.type === 'text' && block.text) {
            textParts.push(block.text);
          }
        }
        const text = textParts.join('');

        if (text && text !== lastTextEntry) {
          gotContent = true;
          const lastIdx = entries.length - 1;
          const lastEntry = lastIdx >= 0 ? entries[lastIdx] : null;
          if (lastEntry && lastEntry.kind === 'text') {
            lastEntry.text = text;
          } else {
            entries.push({ kind: 'text', text });
          }
          lastTextEntry = text;
          hasNewData = true;
        }

        for (const block of contentBlocks) {
          if (block.type === 'tool_use' && block.id && !knownToolIds.has(block.id)) {
            knownToolIds.add(block.id);
            const name = block.name || 'unknown';
            const input = block.input?.command
              || block.input?.file_path
              || (block.input ? JSON.stringify(block.input) : '');
            entries.push({
              kind: 'tool',
              call: { id: block.id, name, input },
            });
            hasNewData = true;
          }
        }

        if (hasNewData) updateItem();
      }

      if (msg.type === 'approval_needed') {
        setDisplayItems(prev => {
          const updated = prev.map(item =>
            item.type === 'ai' && item.id === currentAiId
              ? { ...item, streaming: false, duration: Date.now() - aiStartTime }
              : item
          );
          return [...updated, {
            type: 'approval' as const,
            id: nextBlockId(),
            toolName: msg.toolName,
            toolUseId: msg.toolUseId,
            command: msg.command || '',
            status: 'pending' as const,
          }];
        });
        needsNewBlock = true;
      }

      if (msg.type === 'result') {
        if (msg.result) {
          const text = typeof msg.result === 'string' ? msg.result : '';
          if (text && text !== lastTextEntry) {
            gotContent = true;
            const lastIdx = entries.length - 1;
            const lastEntry = lastIdx >= 0 ? entries[lastIdx] : null;
            if (lastEntry && lastEntry.kind === 'text') {
              lastEntry.text = text;
            } else {
              entries.push({ kind: 'text', text });
            }
            lastTextEntry = text;
            updateItem();
          }
        }
        return;
      }

      if (msg.type === 'done') {
        if (!gotContent) return;
        setDisplayItems(prev => prev.map(item =>
          item.type === 'ai' && item.id === currentAiId
            ? { ...item, streaming: false, duration: Date.now() - aiStartTime }
            : item
        ));
        aiCleanupRef.current = null;
        aiBlockIdRef.current = null;
        handleInputModeChange('shell');
        cleanup();
        finalize();
      }
    });

    aiCleanupRef.current = cleanup;
    aiBlockIdRef.current = aiId;

    providerRef.current.send(fullPrompt, cwd, trustLevel);
  }, [cwd, trustLevel, handleInputModeChange]);

  const handleAskAI = useCallback((block: import('@/types').SegmentedBlock) => {
    const prompt = `The following command ran:\n\n\`\`\`\n$ ${block.command}\n${block.output}\n\`\`\`\n\nAnalyze this and suggest a fix if needed. If you suggest a command, put it in a \`\`\`bash code block.`;
    handleInputModeChange('ai');
    handleAIRequest(prompt);
  }, [handleAIRequest, handleInputModeChange]);

  const handleCopy = useCallback((text: string) => {
    navigator.clipboard.writeText(text);
  }, []);

  const handleRerun = useCallback((command: string) => {
    const pendingBlock = {
      id: 'pending',
      command,
      output: '',
      rawOutput: '',
      promptText: '',
      startTime: Date.now(),
      duration: 0,
      isRemote: false,
    };
    pendingCommandRef.current = { command, startTime: Date.now() };
    setDisplayItems(prev => [...prev, { type: 'command' as const, block: pendingBlock, active: true }]);
    executeCommand(command);
  }, [executeCommand]);

  const handleToolApprove = useCallback((item: DisplayItem & { type: 'approval' }) => {
    window.tai?.ai?.approve(tabId, item.toolUseId, true);
    setDisplayItems(prev => prev.map(di =>
      di.type === 'approval' && di.id === item.id
        ? { ...di, status: 'approved' as const }
        : di
    ));
  }, [tabId]);

  const handleToolReject = useCallback((item: DisplayItem & { type: 'approval' }) => {
    window.tai?.ai?.approve(tabId, item.toolUseId, false);
    setDisplayItems(prev => prev.map(di =>
      di.type === 'approval' && di.id === item.id
        ? { ...di, status: 'rejected' as const }
        : di
    ));
  }, [tabId]);

  useEffect(() => {
    if (!visible) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (altScreenRef.current) return;

      const ctrlOrMeta = e.ctrlKey || e.metaKey;
      if (!ctrlOrMeta) return;

      if (e.key === 'C' && e.shiftKey) {
        e.preventDefault();
        const selection = window.getSelection()?.toString();
        if (selection) navigator.clipboard.writeText(selection);
        return;
      }

      if (e.key === 'V' && e.shiftKey) {
        e.preventDefault();
        navigator.clipboard.readText().then(text => {
          if (text && inputRef.current) inputRef.current.paste(text);
        });
        return;
      }

      if (e.key === 'c' && !e.shiftKey) {
        e.preventDefault();

        if (aiCleanupRef.current) {
          const blockId = aiBlockIdRef.current;
          providerRef.current.stop();
          if (blockId) {
            setDisplayItems(prev => prev.map(item =>
              item.type === 'ai' && item.id === blockId
                ? { ...item, streaming: false }
                : item
            ));
          }
          aiCleanupRef.current();
          aiCleanupRef.current = null;
          aiBlockIdRef.current = null;
          handleInputModeChange('shell');
        }

        if (ptyId !== null) window.tai?.pty?.write(ptyId, '\x03');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [visible, ptyId, handleInputModeChange]);

  useEffect(() => {
    if (!visible) return;
    const handleFocus = () => {
      if (!altScreenVisible) inputRef.current?.focus();
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [visible, altScreenVisible]);

  const sessionHistory = displayItems
    .filter(item => item.type === 'command' || item.type === 'ai')
    .map(item => item.type === 'command' ? item.block.command : (item as DisplayItem & { type: 'ai' }).question);
  const inputHistory = [...shellHistory, ...sessionHistory];

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0, position: 'relative' }}>
      {ptyId !== null && (
        <HiddenXterm
          ref={hiddenXtermRef}
          ptyId={ptyId}
          visible={altScreenVisible}
          onData={(data) => segmenterRef.current.feed(data)}
        />
      )}
      {!altScreenVisible && (
        <BlockList
          items={displayItems}
          activeBlockId={null}
          awaitingInput={awaitingInput}
          cwd={cwd}
          onCopy={handleCopy}
          onAskAI={handleAskAI}
          onRerun={handleRerun}
          onRunSuggested={(cmd) => {
            aiSuggestedCommands.current.add(cmd);
            handleRerun(cmd);
          }}
          onToolApprove={handleToolApprove}
          onToolReject={handleToolReject}
        />
      )}
      {!altScreenVisible && (
        <TerminalInput
          ref={inputRef}
          onSubmit={handleSubmit}
          mode={inputMode}
          onModeChange={handleInputModeChange}
          cwd={cwd}
          promptInfo={promptInfo}
          initialValue={editValue}
          disabled={false}
          history={inputHistory}
          onClear={() => setDisplayItems([])}
        />
      )}
    </div>
  );
}
