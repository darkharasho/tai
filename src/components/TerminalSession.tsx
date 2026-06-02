import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { HiddenXterm } from './HiddenXterm';
import type { HiddenXtermHandle } from './HiddenXterm';
import { BlockList } from './BlockList';
import type { DisplayItem } from './BlockList';
import { TerminalInput } from './TerminalInput';
import type { TerminalInputHandle } from './TerminalInput';
import { DaemonInstallCard } from './DaemonInstallCard';
import { ShellIntegrationInstallCard } from './ShellIntegrationInstallCard';
import { DAEMON_VERSION } from '../daemonVersion';
import { BlockSegmenter } from './BlockSegmenter';
import { createClaudeProvider } from '@/providers/claude';
import { createCodexProvider } from '@/providers/codex';
import { createGeminiProvider } from '@/providers/gemini';
import { useSettings } from '@/hooks/useSettings';
import type { AIProvider, ContextMode, TrustLevel, AIEntry } from '@/types';
import { hasActiveAi } from '@/utils/hasActiveAi';
import { isMultilineCommand } from '@/utils/isMultilineCommand';
import { buildRecentContext } from '@/utils/aiContext';
import { redactHistoryEntries, redactSecrets } from '@/utils/redactSecrets';
import { detectSshError } from '@/utils/sshDetect';
import {
  initialRemoteAi, pillView, onSshChange, enableWatch, setMode,
  setInstalling, setHelperInstalled, dismissOffer, setError,
  type RemoteAiMode, type RememberedHost, type RemoteAiState,
} from '@/utils/remoteAiSession';
import {
  type QueuedPrompt,
  addQueuedPrompt,
  editQueuedPrompt,
  removeQueuedPrompt,
  joinQueuedPrompts,
} from '@/utils/queuedPrompts';

interface TerminalSessionProps {
  tabId: string;
  tabLabel?: string;
  ptyId: number | null;
  cwd: string;
  visible: boolean;
  trustLevel: TrustLevel;
  aiProvider: AIProvider;
  onContextModeChange: (mode: ContextMode) => void;
  onRemoteChange: (isRemote: boolean, sshTarget: string | null) => void;
  remoteExecMode: 'auto' | 'local';
  onRemoteExecModeChange: (mode: 'auto' | 'local') => void;
  onTrustLevelChange: (level: TrustLevel) => void;
  onAiWorkingChange?: (working: boolean) => void;
}

function createProvider(provider: AIProvider, tabId: string) {
  switch (provider) {
    case 'codex': return createCodexProvider(tabId);
    case 'gemini': return createGeminiProvider(tabId);
    default: return createClaudeProvider(tabId);
  }
}

function nextBlockId(): string {
  return `tm-${crypto.randomUUID()}`;
}

export function TerminalSession({ tabId, tabLabel, ptyId, cwd: initialCwd, visible, trustLevel, aiProvider, onContextModeChange, onRemoteChange, remoteExecMode, onRemoteExecModeChange, onTrustLevelChange, onAiWorkingChange }: TerminalSessionProps) {
  const { config } = useSettings();
  const claudeModel = config['claude.model'] || 'sonnet';
  const claudeEffort = config['claude.effort'] || 'auto';
  const [displayItems, setDisplayItems] = useState<DisplayItem[]>([]);
  const [altScreenVisible, setAltScreenVisible] = useState(false);
  const [interactiveMode, setInteractiveMode] = useState(false);
  const [interactivePortalTarget, setInteractivePortalTarget] = useState<HTMLDivElement | null>(null);
  const [xtermFallbackEl, setXtermFallbackEl] = useState<HTMLDivElement | null>(null);
  const [interactiveFullscreen, setInteractiveFullscreen] = useState(false);
  const [inputMode, setInputMode] = useState<'shell' | 'ai'>('shell');
  const handleInputModeChange = useCallback((mode: 'shell' | 'ai') => {
    setInputMode(mode);
    onContextModeChange(mode);
  }, [onContextModeChange]);
  const [cwd, setCwd] = useState(initialCwd);
  const [promptInfo, setPromptInfo] = useState<{ text: string; isRemote: boolean; sshTarget?: string } | null>(null);
  const [remoteAi, setRemoteAi] = useState(initialRemoteAi());
  // Per-host memory so re-entering a known host restores its mode without re-asking.
  const remoteAiMemory = useRef<Map<string, RememberedHost>>(new Map());
  const [shellIntegrated, setShellIntegrated] = useState(false);
  const [sshSessionActive, setSshSessionActive] = useState(false);
  const [sshSessionTarget, setSshSessionTarget] = useState<string | null>(null);
  const [shellIntegrationCard, setShellIntegrationCard] = useState<{ target: string } | null>(null);
  const [remoteSystemInfo, setRemoteSystemInfo] = useState<string>('');
  const remoteSystemInfoRef = useRef('');
  const [daemonToast, setDaemonToast] = useState<{ message: string; ok: boolean } | null>(null);
  const daemonToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [shellHistory, setShellHistory] = useState<string[]>([]);
  const [remoteHistory, setRemoteHistory] = useState<string[]>([]);
  const [awaitingInput, setAwaitingInput] = useState(false);
  const [passwordPrompt, setPasswordPrompt] = useState(false);
  const [editValue, setEditValue] = useState<string | undefined>(undefined);
  const editValueRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    editValueRef.current = editValue;
  }, [editValue]);
  const [queuedPrompts, setQueuedPrompts] = useState<QueuedPrompt[]>([]);
  const queuedPromptsRef = useRef<QueuedPrompt[]>([]);

  useEffect(() => {
    queuedPromptsRef.current = queuedPrompts;
  }, [queuedPrompts]);

  const handleEditQueued = useCallback((id: string, text: string) => {
    setQueuedPrompts(prev => editQueuedPrompt(prev, id, text));
  }, []);

  const handleRemoveQueued = useCallback((id: string) => {
    setQueuedPrompts(prev => removeQueuedPrompt(prev, id));
  }, []);
  const [daemonCardState, setDaemonCardState] = useState<{
    show: boolean;
    mode: 'install' | 'update';
    currentVersion?: string;
    newVersion?: string;
  } | null>(null);

  const tabLabelRef = useRef(tabLabel);
  tabLabelRef.current = tabLabel;

  const segmenterRef = useRef(new BlockSegmenter());
  const hiddenXtermRef = useRef<HiddenXtermHandle>(null);
  const inputRef = useRef<TerminalInputHandle>(null);
  const providerRef = useRef(createProvider(aiProvider, tabId));
  const aiCleanupRef = useRef<(() => void) | null>(null);
  const isAiActive = () => aiCleanupRef.current !== null;
  const aiBlockIdRef = useRef<string | null>(null);
  const aiSuggestedCommands = useRef<Set<string>>(new Set());
  const pendingCommandRef = useRef<{ command: string; startTime: number } | null>(null);
  const altScreenRef = useRef(false);
  const interactiveModeRef = useRef(false);
  const preambleSentRef = useRef(false);
  const lastContextBlockIdRef = useRef<string | null>(null);
  const gitBranchRef = useRef<string | null>(null);
  const capturedOutputRef = useRef<string | null>(null);
  altScreenRef.current = altScreenVisible;
  interactiveModeRef.current = interactiveMode;

  const showDaemonToast = (message: string, ok: boolean) => {
    if (daemonToastTimerRef.current) clearTimeout(daemonToastTimerRef.current);
    setDaemonToast({ message, ok });
    daemonToastTimerRef.current = setTimeout(() => setDaemonToast(null), 4000);
  };

  useEffect(() => {
    providerRef.current.stop();
    providerRef.current = createProvider(aiProvider, tabId);
    preambleSentRef.current = false;
    lastContextBlockIdRef.current = null;
  }, [aiProvider, tabId]);

  // Sync completed command blocks to the main process so the MCP history
  // server can serve them to Claude on demand.
  useEffect(() => {
    const entries = displayItems
      .filter((item): item is DisplayItem & { type: 'command' } => item.type === 'command' && !item.active)
      .slice(-50)
      .map(item => ({
        command: item.block.command,
        output: item.block.output,
        exitCode: item.block.exitCode,
        cwd: item.block.cwd ?? cwd,
        gitBranch: gitBranchRef.current,
        durationMs: item.block.duration,
        timestamp: item.block.startTime,
      }));
    // Strip credentials before history leaves the renderer for the MCP tool.
    window.tai?.ai?.updateHistory(tabId, redactHistoryEntries(entries));
  }, [displayItems, tabId, cwd]);

  useEffect(() => {
    if (initialCwd) setCwd(initialCwd);
  }, [initialCwd]);

  useEffect(() => {
    if (!cwd) { gitBranchRef.current = null; return; }
    let cancelled = false;
    window.tai?.git?.branch(cwd).then(b => { if (!cancelled) gitBranchRef.current = b; });
    return () => { cancelled = true; };
  }, [cwd]);

  useEffect(() => {
    window.tai?.pty?.getShellHistory(500).then((lines: string[]) => setShellHistory(lines));
  }, []);

  useEffect(() => {
    window.tai?.system?.getHostname().then((name: string) => {
      if (name) segmenterRef.current.setLocalHostname(name);
    });
  }, []);

  // Effective remote target for AI: driven by the remote-AI pill.
  const eff = useMemo(() => ({
    isRemote: remoteAi.mode === 'watch' || remoteAi.mode === 'run',
    sshTarget: remoteAi.target,
    // Only "run" routes tool execution to the host; "watch" keeps exec local.
    exec: remoteAi.mode === 'run' ? ('auto' as const) : ('local' as const),
  }), [remoteAi]);

  useEffect(() => {
    if (eff.isRemote && eff.sshTarget) {
      window.tai?.pty?.getRemoteShellHistory(eff.sshTarget, 500)
        .then((lines: string[]) => setRemoteHistory(lines))
        .catch(() => setRemoteHistory([]));
    } else {
      setRemoteHistory([]);
    }
  }, [eff.isRemote, eff.sshTarget]);

  // Persistent listener for daemon lifecycle messages that arrive outside of a conversation
  useEffect(() => {
    const cleanup = window.tai?.ai?.onMessage(tabId, (msg: any) => {
      if (msg.type === 'remote:daemon_connected') {
        if (msg.systemInfo) { setRemoteSystemInfo(msg.systemInfo); remoteSystemInfoRef.current = msg.systemInfo; }
        const infoLine = msg.systemInfo ? ` · ${msg.systemInfo.split('\n')[0]}` : '';
        showDaemonToast(`Connected to remote${infoLine}`, true);
      }
      if (msg.type === 'remote:daemon_connect_failed') {
        showDaemonToast(`Daemon connection failed: ${msg.error}`, false);
      }
      if (msg.type === 'remote:daemon_disconnected') {
        setRemoteSystemInfo(''); remoteSystemInfoRef.current = '';
        showDaemonToast('Daemon disconnected', false);
      }
    });
    return cleanup;
  }, [tabId]);

  useEffect(() => {
    const target = eff.isRemote ? eff.sshTarget : null;
    window.tai?.ai?.setRemoteTarget(tabId, target, eff.exec);
  }, [tabId, eff.isRemote, eff.sshTarget, eff.exec]);

  const remoteTarget = eff.isRemote ? eff.sshTarget : null;

  useEffect(() => {
    if (!remoteTarget) {
      setDaemonCardState(null);
      return;
    }
    // Guard against the daemon.check promise resolving after the user has
    // already left the remote session — without this, a stale `installed: false`
    // result re-shows the install card while remoteTarget is null, rendering
    // "Install TAI Daemon on null?".
    let cancelled = false;
    const target = remoteTarget;
    window.tai.daemon.check(target).then((result: { installed: boolean; version?: string }) => {
      if (cancelled) return;
      const currentVersion = DAEMON_VERSION;
      if (!result.installed) {
        setDaemonCardState({ show: true, mode: 'install', newVersion: currentVersion });
      } else if (result.version !== currentVersion) {
        setDaemonCardState({ show: true, mode: 'update', currentVersion: result.version, newVersion: currentVersion });
      } else {
        setDaemonCardState(null);
        window.tai.ai.setDaemonEnabled(tabId, true);
      }
    });
    return () => { cancelled = true; };
  }, [remoteTarget, tabId]);

  const handleDaemonInstall = () => {
    window.tai.ai.setDaemonEnabled(tabId, true);
  };

  const handleDaemonDismiss = () => {
    setDaemonCardState(null);
  };

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

  const aiWorking = hasActiveAi(displayItems);
  useEffect(() => {
    onAiWorkingChange?.(aiWorking);
  }, [aiWorking, onAiWorkingChange]);

  useEffect(() => {
    if (ptyId === null) return;
    let cancelled = false;
    const segmenter = segmenterRef.current;

    segmenter.onBlock((block) => {
      if (cancelled) return;
      setPasswordPrompt(false);
      const pending = pendingCommandRef.current;
      pendingCommandRef.current = null;
      const captured = capturedOutputRef.current;
      capturedOutputRef.current = null;
      let fixedBlock = pending
        ? { ...block, command: pending.command, duration: Date.now() - pending.startTime }
        : block;
      if (captured) {
        fixedBlock = { ...fixedBlock, output: captured, rawOutput: captured };
      }
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
      if (pending) {
        window.tai?.notify?.completion({
          kind: 'command',
          tabId,
          tabLabel: tabLabelRef.current,
          command: fixedBlock.command,
          duration: fixedBlock.duration,
        });
      }
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

    segmenter.onInteractiveMode((entered, fullscreen) => {
      if (cancelled) return;
      if (entered && fullscreen) {
        hiddenXtermRef.current?.clear();
      } else if (!entered) {
        const content = hiddenXtermRef.current?.getBufferContent();
        if (content) capturedOutputRef.current = content;
      }
      setInteractiveMode(entered);
      setInteractiveFullscreen(entered && !!fullscreen);
      if (!entered) setPasswordPrompt(false);
    });

    segmenter.onPasswordPrompt(() => {
      if (cancelled) return;
      setPasswordPrompt(true);
      setInteractiveMode(true);
    });

    segmenter.onPromptChange((prompt, isRemote, sshTarget) => {
      if (cancelled) return;
      setPromptInfo({ text: prompt, isRemote, sshTarget: sshTarget ?? undefined });
      onRemoteChange(isRemote, sshTarget);
    });

    segmenter.onShellIntegration((active) => {
      if (cancelled) return;
      setShellIntegrated(active);
    });

    segmenter.onSshSession((active, target) => {
      if (cancelled) return;
      setSshSessionActive(active);
      setSshSessionTarget(active ? target : null);
      setRemoteAi(prev => onSshChange(
        prev, active, target,
        active && target ? remoteAiMemory.current.get(target) : undefined,
      ));
    });

    segmenter.onBlockActive((active) => {
      if (cancelled) return;
      if (ptyId === null) return;
      if (active) {
        window.tai?.pty?.startEchoPoll?.(ptyId);
      } else {
        window.tai?.pty?.stopEchoPoll?.(ptyId);
        setPasswordPrompt(false);
      }
    });

    const cleanupEcho = window.tai?.pty?.onEchoChange?.((evtId: number, e: { echo: boolean; icanon: boolean; passwordPrompt: boolean; interactiveProgram: boolean }) => {
      if (cancelled) return;
      if (evtId !== ptyId) return;
      setPasswordPrompt(e.passwordPrompt);
      // Raw-mode tty (REPLs like python/node/psql, plus full TUIs) — route
      // the card through xterm so the user sees keystrokes echo and can
      // use readline navigation/history.
      setInteractiveMode(e.interactiveProgram);
      if (e.interactiveProgram) setInteractiveFullscreen(false);
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

    const cleanupResized = window.tai?.pty?.onResized?.((id: number, cols: number, rows: number) => {
      if (cancelled) return;
      if (id !== ptyId) return;
      segmenterRef.current.onResize(cols, rows);
    });

    return () => {
      cancelled = true;
      cleanupData?.();
      cleanupResized?.();
      cleanupEcho?.();
      if (outputRafId !== null) cancelAnimationFrame(outputRafId);
      segmenter.reset();
      setShellIntegrated(false);
      setSshSessionActive(false);
      setSshSessionTarget(null);
      setShellIntegrationCard(null);
    };
  }, [ptyId, refreshCwd]);

  // When an SSH session has been active for a couple seconds without OSC 133
  // markers arriving from the remote shell, offer to install integration there.
  // Per-target "don't ask again" lives in localStorage.
  useEffect(() => {
    if (!sshSessionActive || !sshSessionTarget) {
      setShellIntegrationCard(null);
      return;
    }
    const dismissKey = `tai:si:dismissed:${sshSessionTarget}`;
    if (localStorage.getItem(dismissKey)) return;

    let cancelled = false;
    // 2.5s delay so we don't prompt during one-shot ssh commands (e.g.
    // `ssh host whoami`). checkRemote is authoritative — if the host already
    // has integration, the card stays hidden.
    const t = setTimeout(async () => {
      if (cancelled) return;
      const result = await window.tai.shellIntegration.checkRemote(sshSessionTarget);
      if (cancelled) return;
      if (!result.installed) {
        setShellIntegrationCard({ target: sshSessionTarget });
      }
    }, 2500);
    return () => { cancelled = true; clearTimeout(t); };
  }, [sshSessionActive, sshSessionTarget]);

  const executeCommand = useCallback((command: string) => {
    if (ptyId === null) return;
    segmenterRef.current.bootstrapPrompt();
    segmenterRef.current.markCommandSent();
    window.tai?.pty?.write(ptyId, command + '\n');
  }, [ptyId]);

  const handleAIRequest = useCallback((prompt: string) => {
    handleInputModeChange('ai');
    const aiId = nextBlockId();
    const aiStartTime = Date.now();
    let gotContent = false;

    const drainQueue = () => {
      if (queuedPromptsRef.current.length > 0) {
        const combined = joinQueuedPrompts(queuedPromptsRef.current);
        setQueuedPrompts([]);
        queuedPromptsRef.current = [];
        handleAIRequestRef.current(combined);
      }
    };

    const fallbackQueueToInput = () => {
      if (queuedPromptsRef.current.length > 0) {
        const combined = joinQueuedPrompts(queuedPromptsRef.current);
        setQueuedPrompts([]);
        queuedPromptsRef.current = [];
        const existing = editValueRef.current;
        setEditValue(existing && existing.trim() ? `${existing}\n\n${combined}` : combined);
      }
    };

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

    const isRemoteExec = eff.isRemote && eff.exec === 'auto';

    let fullPrompt = prompt;
    const lines: string[] = [];
    if (!preambleSentRef.current) {
      preambleSentRef.current = true;
      lines.push(
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
        '- You have a TerminalHistory tool that retrieves recent commands and output from this terminal session. Use it when the user references previous commands, errors, or output.',
      );

      if (isRemoteExec && eff.sshTarget) {
        lines.push(
          '',
          `REMOTE EXECUTION: You are connected to remote host: ${eff.sshTarget}`,
          'All tool calls (Bash, Read, Write, Edit, Grep, Glob) execute on the remote host, not locally.',
        );
        if (remoteSystemInfoRef.current) {
          lines.push(`Remote system: ${remoteSystemInfoRef.current}`);
        }
      }

    }
    const recent = buildRecentContext(displayItems, lastContextBlockIdRef.current, {
      cwd,
      gitBranch: gitBranchRef.current,
    });
    if (recent.text) {
      lines.push('', recent.text);
    } else {
      lines.push(`Working directory: ${cwd}`);
    }
    lastContextBlockIdRef.current = recent.lastId;
    // Watch mode: AI runs locally but should see the remote session.
    // Runs every turn so the context stays current.
    if (eff.isRemote && eff.exec === 'local' && eff.sshTarget) {
      const remoteOut = displayItems
        .filter((it): it is DisplayItem & { type: 'command' } => it.type === 'command' && !!it.block.isRemote)
        .slice(-5)
        .map(it => `$ ${it.block.command}\n${(it.block.output || '').trim()}`.trim())
        .join('\n\n');
      if (remoteOut.trim()) {
        lines.push(
          '',
          `REMOTE SESSION (observe-only): the user is in an ssh session on ${eff.sshTarget}.`,
          'Recent remote activity follows. Your tools still run locally; help by reading this context.',
          redactSecrets(remoteOut),
        );
      }
    }
    if (lines.length > 0) {
      fullPrompt = `<system>\n${lines.join('\n')}\n</system>\n\n${prompt}`;
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
        let isDelta = false;
        for (const block of contentBlocks) {
          if (block.type === 'text' && block.text) {
            textParts.push(block.text);
            if (block.delta) isDelta = true;
          }
        }
        const text = textParts.join('');

        if (text && (isDelta || text !== lastTextEntry)) {
          gotContent = true;
          const lastIdx = entries.length - 1;
          const lastEntry = lastIdx >= 0 ? entries[lastIdx] : null;
          if (lastEntry && lastEntry.kind === 'text') {
            const updated = isDelta ? (lastEntry.text || '') + text : text;
            lastEntry.text = updated;
            lastTextEntry = updated;
          } else {
            entries.push({ kind: 'text', text });
            lastTextEntry = text;
          }
          hasNewData = true;
        }

        for (const block of contentBlocks) {
          if (block.type === 'tool_use' && block.id && !knownToolIds.has(block.id)) {
            knownToolIds.add(block.id);
            const name = block.name || 'unknown';
            const input = block.input ? JSON.stringify(block.input) : '';
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

      if (msg.type === 'remote:connection_failed') {
        const sshErr = detectSshError(msg.error ?? '');
        const hint = sshErr ? `\n\n${sshErr.message}` : '';
        setDisplayItems(prev => [...prev, {
          type: 'ai' as const,
          id: nextBlockId(),
          question: '',
          content: `**SSH connection failed:** ${msg.error}${hint}\n\nAI commands will run locally. Use key-based SSH auth for remote AI support.`,
          suggestedCommands: [],
          streaming: false,
          entries: [{ kind: 'text' as const, text: `**SSH connection failed:** ${msg.error}${hint}\n\nAI commands will run locally.` }],
        }]);
        return;
      }

      if (msg.type === 'error' && msg.text) {
        gotContent = true;
        const errorText = `**Error:** ${msg.text}`;
        const lastIdx = entries.length - 1;
        const lastEntry = lastIdx >= 0 ? entries[lastIdx] : null;
        if (lastEntry && lastEntry.kind === 'text') {
          lastEntry.text += '\n\n' + errorText;
        } else {
          entries.push({ kind: 'text', text: errorText });
        }
        lastTextEntry = errorText;
        updateItem();
        fallbackQueueToInput();
        return;
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
        if (!gotContent) {
          setDisplayItems(prev => prev.filter(item => !(item.type === 'ai' && item.id === currentAiId)));
          aiCleanupRef.current = null;
          aiBlockIdRef.current = null;
          if (queuedPromptsRef.current.length === 0) {
            handleInputModeChange('shell');
          }
          cleanup();
          drainQueue();
          return;
        }
        setDisplayItems(prev => prev.map(item =>
          item.type === 'ai' && item.id === currentAiId
            ? { ...item, streaming: false, duration: Date.now() - aiStartTime }
            : item
        ));
        aiCleanupRef.current = null;
        aiBlockIdRef.current = null;
        if (queuedPromptsRef.current.length === 0) {
          handleInputModeChange('shell');
        }
        cleanup();
        finalize();
        window.tai?.notify?.completion({
          kind: 'ai',
          tabId,
          tabLabel: tabLabelRef.current,
          provider: aiProvider,
          duration: Date.now() - aiStartTime,
          summary: lastTextEntry,
        });
        drainQueue();
      }
    });

    aiCleanupRef.current = cleanup;
    aiBlockIdRef.current = aiId;

    providerRef.current.send(fullPrompt, cwd, trustLevel, claudeModel, claudeEffort);
  }, [cwd, trustLevel, handleInputModeChange, promptInfo, eff, claudeModel, claudeEffort, displayItems]);

  const handleAIRequestRef = useRef(handleAIRequest);
  useEffect(() => {
    handleAIRequestRef.current = handleAIRequest;
  }, [handleAIRequest]);

  // Derived early so handleSubmit can reference it for the shell-submit guard.
  const hasActiveBlock = displayItems.some(item => item.type === 'command' && item.active);

  const handleSubmit = useCallback((value: string) => {
    if (inputMode === 'shell') {
      // When remote-AI is active the composer is unlocked during a foreground
      // command, but shell submits must not write to the PTY mid-command
      // (the running command owns stdin). Block the submit; the user can switch
      // to AI mode to send queries while the foreground command is running.
      if (hasActiveBlock) return;
      const isMultiline = isMultilineCommand(value);
      // Multi-line inputs are sent raw — bash handles each line as a separate
      // command (or as a continuation for heredocs/loops), and each gets its
      // own block via OSC 133 markers. Wrapping in `bash -c '...'` would
      // collapse everything into one block AND pollute the output buffer with
      // PS2 echoes from the outer shell's multi-line readline.
      const display = isMultiline ? value : value.trim();
      const toRun = isMultiline ? value : value.trim();
      const pendingBlock = {
        id: 'pending',
        command: display,
        output: '',
        rawOutput: '',
        promptText: promptInfo?.text ?? '',
        startTime: Date.now(),
        duration: 0,
        isRemote: promptInfo?.isRemote ?? false,
      };
      // Only show a pending placeholder for single-line commands; multi-line
      // would otherwise show one big pending card while N real blocks arrive.
      if (!isMultiline) {
        pendingCommandRef.current = { command: display, startTime: Date.now() };
      }
      setDisplayItems(prev => {
        const cleaned = prev.map(item =>
          item.type === 'command' && item.block.id === 'pending'
            ? { ...item, active: false, block: { ...item.block, id: `stale-${Date.now()}` } }
            : item
        );
        if (isMultiline) return cleaned;
        return [...cleaned, { type: 'command' as const, block: pendingBlock, active: true }];
      });
      executeCommand(toRun);
      setEditValue(undefined);
    } else if (aiWorking || isAiActive()) {
      setQueuedPrompts(prev => addQueuedPrompt(prev, value));
      setEditValue('');
    } else {
      handleAIRequest(value);
    }
  }, [inputMode, hasActiveBlock, executeCommand, promptInfo, aiWorking, handleAIRequest]);

  const handleAskAI = useCallback((block: import('@/types').SegmentedBlock) => {
    const prompt = `The following command ran:\n\n\`\`\`\n$ ${block.command}\n${block.output}\n\`\`\`\n\nAnalyze this and suggest a fix if needed. If you suggest a command, put it in a \`\`\`bash code block.`;
    handleInputModeChange('ai');
    handleAIRequest(prompt);
  }, [handleAIRequest, handleInputModeChange]);

  const handleCopy = useCallback((text: string) => {
    navigator.clipboard.writeText(text);
  }, []);

  const handleRerun = useCallback((command: string, displayCommand?: string) => {
    const display = displayCommand ?? command;
    const pendingBlock = {
      id: 'pending',
      command: display,
      output: '',
      rawOutput: '',
      promptText: promptInfo?.text ?? '',
      startTime: Date.now(),
      duration: 0,
      isRemote: promptInfo?.isRemote ?? false,
    };
    pendingCommandRef.current = { command: display, startTime: Date.now() };
    setDisplayItems(prev => [...prev, { type: 'command' as const, block: pendingBlock, active: true }]);
    executeCommand(command);
  }, [executeCommand, promptInfo]);

  const handleStopAI = useCallback(() => {
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
    setQueuedPrompts([]);
    queuedPromptsRef.current = [];
  }, [handleInputModeChange]);

  const rememberRemoteAi = useCallback((s: RemoteAiState) => {
    if (s.target) {
      remoteAiMemory.current.set(s.target, {
        mode: s.mode,
        helperInstalled: s.helperInstalled,
        dismissed: s.dismissed,
      });
    }
  }, []);

  const handleEnableRemoteAi = useCallback(() => {
    setRemoteAi(prev => { const next = enableWatch(prev); rememberRemoteAi(next); return next; });
  }, [rememberRemoteAi]);

  const handleDismissRemoteAi = useCallback(() => {
    setRemoteAi(prev => { const next = dismissOffer(prev); rememberRemoteAi(next); return next; });
  }, [rememberRemoteAi]);

  const handleSetRemoteAiMode = useCallback(async (mode: RemoteAiMode) => {
    if (mode !== 'run') {
      setRemoteAi(prev => { const next = setMode(prev, mode); rememberRemoteAi(next); return next; });
      return;
    }
    const { target, helperInstalled } = remoteAi;
    if (!target) return;
    if (!helperInstalled) {
      setRemoteAi(prev => setInstalling(prev, true));
    }
    try {
      if (!helperInstalled) {
        const res = await window.tai.daemon.check(target);
        if (!res.installed) {
          const r = await window.tai.daemon.install(target);
          if (!r?.success) throw new Error(r?.error || 'daemon install failed');
        }
      }
      await window.tai.ai.setDaemonEnabled(tabId, true);
      setRemoteAi(prev => {
        const base = setInstalling(prev, false);
        const withHelper = setHelperInstalled(base, true);
        const next = setMode(withHelper, 'run');
        rememberRemoteAi(next);
        return next;
      });
    } catch (e: any) {
      setRemoteAi(prev => {
        const next = setError(setInstalling(prev, false), e instanceof Error ? e.message : String(e));
        rememberRemoteAi(next);
        return next;
      });
    }
  }, [tabId, remoteAi, rememberRemoteAi]);

  const handleToolApprove = useCallback((item: DisplayItem & { type: 'approval' }) => {
    if (providerRef.current.id === 'gemini') {
      window.tai.gemini.approve(tabId, item.toolUseId, true);
    } else {
      window.tai?.ai?.approve(tabId, item.toolUseId, true);
    }
    setDisplayItems(prev => prev.map(di =>
      di.type === 'approval' && di.id === item.id
        ? { ...di, status: 'approved' as const }
        : di
    ));
  }, [tabId]);

  const handleToolReject = useCallback((item: DisplayItem & { type: 'approval' }) => {
    if (providerRef.current.id === 'gemini') {
      window.tai.gemini.approve(tabId, item.toolUseId, false);
    } else {
      window.tai?.ai?.approve(tabId, item.toolUseId, false);
    }
    setDisplayItems(prev => prev.map(di =>
      di.type === 'approval' && di.id === item.id
        ? { ...di, status: 'rejected' as const }
        : di
    ));
  }, [tabId]);

  useEffect(() => {
    if (!visible) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (altScreenRef.current || interactiveModeRef.current) return;

      const isMac = navigator.platform.startsWith('Mac');
      const ctrlOrMeta = e.ctrlKey || e.metaKey;
      if (!ctrlOrMeta) return;

      // Copy: Cmd+C (macOS) or Ctrl+Shift+C (Linux/Windows)
      if ((isMac && e.metaKey && e.key === 'c' && !e.shiftKey) ||
          (!isMac && e.ctrlKey && e.key === 'C' && e.shiftKey)) {
        e.preventDefault();
        const selection = window.getSelection()?.toString();
        if (selection) navigator.clipboard.writeText(selection);
        return;
      }

      // Paste: Cmd+V (macOS) or Ctrl+Shift+V (Linux/Windows)
      if ((isMac && e.metaKey && e.key === 'v' && !e.shiftKey) ||
          (!isMac && e.ctrlKey && e.key === 'V' && e.shiftKey)) {
        e.preventDefault();
        navigator.clipboard.readText().then(text => {
          if (text && inputRef.current) inputRef.current.paste(text);
        });
        return;
      }

      // SIGINT: Ctrl+C (all platforms, not Cmd+C on macOS)
      if (e.key === 'c' && e.ctrlKey && !e.metaKey && !e.shiftKey) {
        e.preventDefault();
        handleStopAI();
        if (ptyId !== null) window.tai?.pty?.write(ptyId, '\x03');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [visible, ptyId, handleStopAI]);

  useEffect(() => {
    if (!visible) return;
    const handleFocus = () => {
      if (!altScreenVisible && !awaitingInput && !passwordPrompt) inputRef.current?.focus();
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [visible, altScreenVisible, awaitingInput, passwordPrompt]);

  useEffect(() => {
    if (awaitingInput || passwordPrompt) {
      inputRef.current?.blur();
    } else if (!altScreenVisible) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [awaitingInput, passwordPrompt, altScreenVisible]);

  const isRemote = promptInfo?.isRemote ?? false;
  const sessionHistory = displayItems
    .filter(item => {
      if (item.type === 'command') return item.block.isRemote === isRemote;
      if (item.type === 'ai') return !isRemote;
      return false;
    })
    .map(item => item.type === 'command' ? item.block.command : (item as DisplayItem & { type: 'ai' }).question);
  const baseHistory = isRemote ? remoteHistory : shellHistory;
  const inputHistory = [...baseHistory, ...sessionHistory];

  const handleSendInput = useCallback((data: string) => {
    if (ptyId === null) return;
    window.tai?.pty?.write(ptyId, data);
  }, [ptyId]);

  const showFullscreenInteractive = interactiveMode && interactiveFullscreen && !altScreenVisible;
  // showXterm now includes any interactiveMode (REPLs flagged by termios raw
  // mode), not just legacy CURSOR_HIDE-style fullscreen. xterm gets routed
  // into the card via the interactive-portal target, not the session overlay.
  const showXterm = altScreenVisible || showFullscreenInteractive || interactiveMode;
  const blockInputLocked = awaitingInput || passwordPrompt;
  // When remote-AI is active, keep the composer usable during a foreground
  // command (e.g. the interactive ssh) — AI input is out-of-band from the PTY.
  // Shell submits still queue (handled in the submit path); password/awaiting locks stay.
  const remoteAiActive = remoteAi.mode === 'watch' || remoteAi.mode === 'run';
  const inputDisabled = blockInputLocked || (hasActiveBlock && !passwordPrompt && !remoteAiActive);
  const activeBodyMode: import('@/types').BlockBodyMode =
    passwordPrompt ? 'password'
    : (altScreenVisible || interactiveMode) ? 'interactive'
    : 'output';

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0, position: 'relative' }}>
      {!showXterm && daemonCardState?.show && remoteTarget && (
        <DaemonInstallCard
          target={remoteTarget}
          mode={daemonCardState.mode}
          currentVersion={daemonCardState.currentVersion}
          newVersion={daemonCardState.newVersion}
          onInstall={handleDaemonInstall}
          onDismiss={handleDaemonDismiss}
        />
      )}
      {!showXterm && shellIntegrationCard && (
        <ShellIntegrationInstallCard
          target={shellIntegrationCard.target}
          onInstalled={() => { /* Will activate on the user's next reconnect. */ }}
          onDismiss={() => {
            if (shellIntegrationCard) {
              localStorage.setItem(`tai:si:dismissed:${shellIntegrationCard.target}`, '1');
            }
            setShellIntegrationCard(null);
          }}
        />
      )}
      {(
        <BlockList
          items={displayItems}
          activeBlockId={null}
          awaitingInput={awaitingInput}
          cwd={cwd}
          onCopy={handleCopy}
          onAskAI={handleAskAI}
          onRerun={handleRerun}
          onRunSuggested={(cmd) => {
            const toRun = cmd.includes('\n')
              ? `bash -c '${cmd.replace(/'/g, `'\\''`)}'`
              : cmd;
            aiSuggestedCommands.current.add(toRun);
            handleRerun(toRun, cmd);
          }}
          onToolApprove={handleToolApprove}
          onToolReject={handleToolReject}
          onStopAI={handleStopAI}
          onSendInput={handleSendInput}
          queuedPrompts={queuedPrompts}
          onEditQueued={handleEditQueued}
          onRemoveQueued={handleRemoveQueued}
          aiProvider={aiProvider}
          activeBodyMode={activeBodyMode}
          ptyId={ptyId ?? undefined}
          onPasswordDone={() => setPasswordPrompt(false)}
          onInteractiveContainerRef={setInteractivePortalTarget}
        />
      )}
      {/* Stable home for the xterm DOM. HiddenXterm always renders here so its
          xterm.js instance is never disposed/remounted. When alt-screen is active
          and the active card exposes a portal container, we imperatively relocate
          the xterm's outer DOM element into the card, then move it back when the
          card goes away. This preserves xterm's buffer/render state across the
          transition. */}
      <div
        ref={setXtermFallbackEl}
        style={
          showXterm && !interactivePortalTarget
            ? { flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }
            : { position: 'absolute', width: 0, height: 0, overflow: 'hidden', visibility: 'hidden', pointerEvents: 'none' }
        }
      />
      {ptyId !== null && xtermFallbackEl && (
        <HiddenXterm
          ref={hiddenXtermRef}
          ptyId={ptyId}
          visible={showXterm}
          onData={(data) => segmenterRef.current.feed(data)}
          hostEl={(showXterm && interactivePortalTarget) ? interactivePortalTarget : xtermFallbackEl}
        />
      )}
      {/* Password prompt is now rendered inside the active CommandBlock via bodyMode='password'. */}
      {!showXterm && (
        <div style={{ flexShrink: 0, opacity: inputDisabled ? (blockInputLocked ? 0.3 : 0.5) : 1, pointerEvents: blockInputLocked ? 'none' : 'auto', transition: 'opacity 0.15s', cursor: inputDisabled && !blockInputLocked ? 'not-allowed' : undefined }}>
          <TerminalInput
            ref={inputRef}
            onSubmit={handleSubmit}
            mode={inputMode}
            onModeChange={handleInputModeChange}
            cwd={cwd}
            promptInfo={eff.isRemote
              ? { text: promptInfo?.text ?? '', isRemote: true, sshTarget: eff.sshTarget ?? undefined }
              : promptInfo}
            shellIntegrated={shellIntegrated && !sshSessionActive}
            initialValue={editValue}
            disabled={inputDisabled}
            history={inputHistory}
            onClear={() => setDisplayItems([])}
            remoteAiView={pillView(remoteAi)}
            onEnableRemoteAi={handleEnableRemoteAi}
            onSetRemoteAiMode={handleSetRemoteAiMode}
            onDismissRemoteAi={handleDismissRemoteAi}
            aiProvider={aiProvider}
            trustLevel={trustLevel}
            onTrustLevelChange={onTrustLevelChange}
          />
        </div>
      )}
      {daemonToast && (
        <div style={{
          position: 'fixed', bottom: 16, right: 16, zIndex: 2500,
          background: 'var(--bg-card)', border: '1px solid var(--border-card)',
          borderRadius: 8, padding: '10px 14px', display: 'flex', alignItems: 'center',
          gap: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.4)', fontSize: 13,
          color: 'var(--text-primary)', fontFamily: 'var(--font-sans)', maxWidth: 360,
          animation: 'slideIn 0.2s ease',
        }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
            background: daemonToast.ok ? 'var(--color-success, #4ade80)' : 'var(--color-error, #f87171)' }} />
          {daemonToast.message}
          <button onClick={() => setDaemonToast(null)} style={{
            background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer',
            padding: 2, borderRadius: 4, marginLeft: 'auto', display: 'flex',
          }}>✕</button>
        </div>
      )}
    </div>
  );
}
