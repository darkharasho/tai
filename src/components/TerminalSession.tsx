import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { HiddenXterm } from './HiddenXterm';
import type { HiddenXtermHandle } from './HiddenXterm';
import { BlockList } from './BlockList';
import type { DisplayItem } from './BlockList';
import { TerminalInput, RemoteAiPill } from './TerminalInput';
import type { TerminalInputHandle } from './TerminalInput';
import { CommandBlock } from './CommandBlock';
import {
  deriveInputSurface, focusTargetFor, composerVisible, pinnedActiveBlock, shouldShowXterm,
} from '@/utils/inputSurface';
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
import { patchBlock } from '@/utils/blockMeta';
import { BlockFinder } from './BlockFinder';
import { SessionSideChat } from './SessionSideChat';
import { SudoCacheBadge, useSudoCacheState } from './SudoCacheBadge';
import { buildSessionAiPrompt } from '@/utils/sessionAiPrompt';
import { assembleInputHistory } from '@/utils/inputHistory';
import { persistBlocks, loadBlocks } from '@/utils/sessionRestore';
import { classifySessionCommand, shouldRootSession, detectPort, LONG_RUN_PROMOTE_MS, type SessionKind } from '@/utils/sessionKind';
import { summarizeSession } from '@/utils/sessionSummary';
import { preserveStreamedOutput } from '@/utils/finalizeOutput';
import { classifyKeyTarget } from '@/utils/keyRouting';
import { isMultilineCommand } from '@/utils/isMultilineCommand';
import { createIndex, ingestBlock, shouldIndexBlock } from '@/utils/commandIndex';
import type { CommandIndex } from '@/utils/commandIndex';
import { buildRecentContext } from '@/utils/aiContext';
import { redactHistoryEntries, redactSecrets } from '@/utils/redactSecrets';
import { detectSshError } from '@/utils/sshDetect';
import { capDisplayItems } from '@/utils/blockCap';
import { clampStoredOutput } from '@/utils/clampStoredOutput';
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
import { useAiCleanupOnUnmount } from '@/hooks/useAiCleanupOnUnmount';
import { useSingleShotAi } from '@/hooks/useSingleShotAi';
import { CommandPalette } from './CommandPalette';
import { WorkflowRunDialog } from './WorkflowRunDialog';
import type { PaletteItem } from '@/utils/palette';
import type { Workflow } from '@/utils/workflows';
import { parseParams } from '@/utils/workflows';
import { frecency } from '@/utils/commandIndex';
import { getCommandNames } from '@/completions/registry';

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
  const aiNextCommandRefine = !!config['aiNextCommandRefine'];
  // Seed with the previous session's finished blocks (rendered collapsed);
  // best-effort, so a corrupt payload just yields an empty session.
  const [displayItems, setDisplayItems] = useState<DisplayItem[]>(() =>
    loadBlocks(tabId).map(block => ({ type: 'command' as const, block, restored: true })));
  const [findOpen, setFindOpen] = useState(false);
  const [sideChatOpen, setSideChatOpen] = useState(false);
  const displayItemsRef = useRef<DisplayItem[]>([]);
  useEffect(() => { displayItemsRef.current = displayItems; }, [displayItems]);
  const [altScreenVisible, setAltScreenVisible] = useState(false);
  // Long-running session state: drives the rooted surface and the morphed
  // card header. Mirrored into a ref for the segmenter callbacks (registered
  // once on mount, so they can't see fresh state).
  const [activeSession, setActiveSession] = useState<{ kind: SessionKind; command: string; rooted: boolean; port: number | null } | null>(null);
  const activeSessionRef = useRef(activeSession);
  useEffect(() => { activeSessionRef.current = activeSession; }, [activeSession]);
  const sessionPromoteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRestartRef = useRef<string | null>(null);
  const rerunRef = useRef<((command: string, displayCommand?: string) => void) | null>(null);
  useEffect(() => () => {
    // Clear ALL timer refs on unmount so they cannot fire setState on a dead component.
    // daemonToastTimerRef and echoInteractiveTimerRef are declared further below in the
    // same component; refs are stable objects so the closure captures them correctly.
    for (const r of [sessionPromoteTimerRef, daemonToastTimerRef, echoInteractiveTimerRef, findFlashTimerRef] as Array<React.MutableRefObject<ReturnType<typeof setTimeout> | number | null>>) {
      if (r.current != null) { clearTimeout(r.current as ReturnType<typeof setTimeout>); r.current = null; }
    }
  }, []);

  const beginSession = useCallback((command: string) => {
    const kind = classifySessionCommand(command);
    if (sessionPromoteTimerRef.current) clearTimeout(sessionPromoteTimerRef.current);
    sessionPromoteTimerRef.current = null;
    setActiveSession({ kind, command, rooted: shouldRootSession(kind, 0), port: null });
    // Shell/connection terminators can stall waiting on remote teardown —
    // never promote them into a rooted session card with STOP/stdin chrome.
    if (/^(exit|logout)\b/.test(command.trim())) return;
    if (kind === 'oneshot') {
      // Unknown commands morph once they've clearly become long-running.
      sessionPromoteTimerRef.current = setTimeout(() => {
        sessionPromoteTimerRef.current = null;
        setActiveSession(s => s && !s.rooted && s.kind === 'oneshot' ? { ...s, rooted: true } : s);
      }, LONG_RUN_PROMOTE_MS);
    }
  }, []);
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
  // Persisted to settings.json so it survives app restarts.
  const remoteAiMemory = useRef<Map<string, RememberedHost>>(new Map());
  const remoteAiMemoryLoaded = useRef(false);
  useEffect(() => {
    if (remoteAiMemoryLoaded.current) return;
    remoteAiMemoryLoaded.current = true;
    window.tai?.config?.get().then((cfg: Record<string, any>) => {
      const saved = cfg['remote.rememberedHosts'];
      if (saved && typeof saved === 'object') {
        for (const [host, mem] of Object.entries(saved)) {
          remoteAiMemory.current.set(host, mem as RememberedHost);
        }
      }
    });
  }, []);
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
  const [commandIndex, setCommandIndex] = useState<CommandIndex>(() => createIndex());
  const lastFinalizedCommandRef = useRef<string | undefined>(undefined);
  const [lastFinalizedCmd, setLastFinalizedCmd] = useState<string | undefined>(undefined);
  const [lastFinalizedExit, setLastFinalizedExit] = useState<number | undefined>(undefined);
  const [awaitingInput, setAwaitingInput] = useState(false);
  const [passwordPrompt, setPasswordPrompt] = useState(false);
  const sudoCache = useSudoCacheState(ptyId);
  const [editValue, setEditValue] = useState<string | undefined>(undefined);
  const editValueRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    editValueRef.current = editValue;
  }, [editValue]);
  const [queuedPrompts, setQueuedPrompts] = useState<QueuedPrompt[]>([]);
  const queuedPromptsRef = useRef<QueuedPrompt[]>([]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteItems, setPaletteItems] = useState<PaletteItem[]>([]);
  const [wfDialog, setWfDialog] = useState<Workflow | null>(null);

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
  useAiCleanupOnUnmount(tabId, aiCleanupRef);
  // Single-shot AI for predictive next-command refine. Uses a dedicated key
  // (${tabId}::predict) so it never collides with the tab's real AI session.
  const singleShotAi = useSingleShotAi(tabId, {
    cwd,
    model: claudeModel,
    effort: claudeEffort,
    permMode: trustLevel,
  });
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
  // Debounce timer for echo-poller interactiveMode activation. Commands like
  // `brew` briefly disable ICANON for progress bars; without debouncing, the
  // surface flips to `docked` and the card pops out of the scroll list instead
  // of morphing in-place from the pending block.
  const echoInteractiveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    window.tai?.commandIndex?.get().then((idx) => idx && setCommandIndex(idx));
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

  // Stamp WHEN the session went remote so only blocks born after that moment
  // wear the agent-orange accent — flipping the pill must not retro-color
  // local history. Ref mutation during render is safe here (idempotent).
  const remoteSinceRef = useRef<number | null>(null);
  if (eff.isRemote && remoteSinceRef.current == null) {
    remoteSinceRef.current = Date.now();
  } else if (!eff.isRemote && remoteSinceRef.current != null) {
    remoteSinceRef.current = null;
  }

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
    const interval = setInterval(poll, 400);
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
      // Hide the initial shell-integration injection (`. /path/to/tai-zsh.zsh`
      // or `source .../tai-bash.sh` etc.) — this is an internal concern and
      // should never appear as a visible card.
      if (/^(?:\.|source)\s+.*\btai-(?:zsh|bash|fish)\b/.test(block.command)) return;
      setPasswordPrompt(false);
      const pending = pendingCommandRef.current;
      pendingCommandRef.current = null;
      const captured = capturedOutputRef.current;
      capturedOutputRef.current = null;
      let fixedBlock = pending
        ? { ...block, command: pending.command, duration: Date.now() - pending.startTime }
        : block;
      if (captured && captured.trim()) {
        fixedBlock = { ...fixedBlock, output: captured, rawOutput: captured };
      }
      const isSuggested = aiSuggestedCommands.current.has(fixedBlock.command);
      if (isSuggested) aiSuggestedCommands.current.delete(fixedBlock.command);
      // Session un-morph: tag the finished block and summarize it. Finished
      // sessions stay expanded in history — after a ^C on `npm run dev` or
      // `pm2 logs` the tail of the output is exactly what the user wants.
      const sess = activeSessionRef.current;
      const sessionEnded = !!(pending && sess && (sess.rooted || sess.kind === 'agent'));
      if (sessionEnded && sess) {
        fixedBlock = {
          ...fixedBlock,
          sessionKind: sess.kind,
          summaryLine: summarizeSession(sess.kind, fixedBlock.output, sess.port),
        };
      }
      if (pending) {
        if (sessionPromoteTimerRef.current) {
          clearTimeout(sessionPromoteTimerRef.current);
          sessionPromoteTimerRef.current = null;
        }
        setActiveSession(null);
      }
      // Orphan detection: a leftover ACTIVE pending card whose command just
      // finalized without consuming pendingCommandRef (e.g. a frame that
      // collapsed out from under it). The command must match — during an
      // interactive ssh session, nested remote blocks routinely arrive with
      // no local pending, and those must NOT deactivate the live ssh card.
      const orphaned = !pending && displayItemsRef.current.some(item =>
        item.type === 'command' && item.block.id === 'pending' && item.active &&
        item.block.command === fixedBlock.command,
      );
      // Ingest the finalized block into the command index for ghost-text ranking.
      // We resolve the cwd via getCwd (reads /proc/<pid>/cwd on Linux) so the
      // stored cwd is the canonical/symlink-resolved path — matching the form
      // the predictor receives from the tab `cwd` state (also sourced from
      // getCwd). Using fixedBlock.cwd here would preserve symlinks (e.g.
      // $PWD = /var/home/user) while the predictor sees the resolved form
      // (/home/user), causing cwdCounts lookups to never match.
      if (shouldIndexBlock({ isRemote: fixedBlock.isRemote, command: fixedBlock.command ?? '' })) {
        const prevCmd = lastFinalizedCommandRef.current;
        lastFinalizedCommandRef.current = fixedBlock.command;
        setLastFinalizedCmd(fixedBlock.command);
        setLastFinalizedExit(fixedBlock.exitCode);
        const _ingestCmd = fixedBlock.command;
        const _ingestExit = fixedBlock.exitCode;
        const _ingestTs = fixedBlock.startTime || Date.now();
        (async () => {
          // For remote blocks shouldIndexBlock already returns false above, so
          // here we know the block is local and pty cwd is valid.
          const resolvedCwd = ptyId !== null
            ? (await window.tai?.pty?.getCwd(ptyId) ?? fixedBlock.cwd)
            : fixedBlock.cwd;
          const entry = {
            command: _ingestCmd,
            cwd: resolvedCwd,
            exitCode: _ingestExit,
            ts: _ingestTs,
            prevCommand: prevCmd,
          };
          window.tai?.commandIndex?.ingest([entry]);
          setCommandIndex((prev) => { ingestBlock(prev, entry); return { ...prev }; });
        })();
      }
      setDisplayItems(prev => {
        if (pending) {
          const idx = prev.findIndex(item => item.type === 'command' && item.block.id === 'pending');
          if (idx !== -1) {
            const next = [...prev];
            const prevItem = next[idx] as DisplayItem & { type: 'command' };
            // A raw-mode flip (vite shortcuts etc.) can finalize with empty
            // output — keep what was streamed into the pending card, and
            // recompute the summary against the preserved text.
            let finalBlock = preserveStreamedOutput(fixedBlock, prevItem.block);
            if (sessionEnded && sess && finalBlock.output !== fixedBlock.output) {
              finalBlock = { ...finalBlock, summaryLine: summarizeSession(sess.kind, finalBlock.output, sess.port) };
            }
            next[idx] = { type: 'command', block: finalBlock, aiSuggested: isSuggested };
            return capDisplayItems(next);
          }
        }
        const cleaned = orphaned
          ? prev.map(item =>
              item.type === 'command' && item.block.id === 'pending' && item.active
                ? { ...item, active: false, block: { ...item.block, id: `stale-${Date.now()}` } }
                : item)
          : prev;
        return capDisplayItems([...cleaned, { type: 'command', block: fixedBlock, aiSuggested: isSuggested }]);
      });
      // The orphan's session morph also lingers — clear the STOP/stdin chrome.
      if (orphaned && activeSessionRef.current) {
        if (sessionPromoteTimerRef.current) {
          clearTimeout(sessionPromoteTimerRef.current);
          sessionPromoteTimerRef.current = null;
        }
        setActiveSession(null);
      }
      // Queued RESTART: re-run once the stopped session's block has finalized.
      if (pending && pendingRestartRef.current) {
        const cmd = pendingRestartRef.current;
        pendingRestartRef.current = null;
        setTimeout(() => rerunRef.current?.(cmd), 150);
      }
      if (pending) {
        window.tai?.notify?.completion({
          kind: 'command',
          tabId,
          tabLabel: tabLabelRef.current,
          command: fixedBlock.command,
          duration: fixedBlock.duration,
        });
      }
      // Resolve the git branch for the card chip from the post-exec cwd
      // (cached main-process lookup). Local blocks only — the cwd of a
      // remote block means nothing on this machine.
      if (fixedBlock.cwd && !fixedBlock.isRemote) {
        const blockId = fixedBlock.id;
        window.tai?.git?.branch?.(fixedBlock.cwd)
          .then((branch) => {
            if (cancelled || !branch) return;
            setDisplayItems(prev => patchBlock(prev, blockId, { gitBranch: branch }));
          })
          .catch(() => {});
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
        // Session port chip: first local port mentioned in output wins.
        const liveSess = activeSessionRef.current;
        if (liveSess && liveSess.port == null && (liveSess.rooted || liveSess.kind === 'agent')) {
          const p = detectPort(current.clean);
          if (p != null) setActiveSession(s => (s && s.port == null ? { ...s, port: p } : s));
        }
        setDisplayItems(prev => {
          const idx = prev.findIndex(item => item.type === 'command' && item.block.id === 'pending');
          if (idx === -1) return prev;
          const next = [...prev];
          const item = next[idx];
          if (item.type === 'command') {
            next[idx] = { ...item, block: { ...item.block, output: clampStoredOutput(current.clean), rawOutput: clampStoredOutput(current.raw) } };
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
        if (content && content.trim()) capturedOutputRef.current = content;
      }
      setInteractiveMode(entered);
      setInteractiveFullscreen(entered && !!fullscreen);
      if (!entered) setPasswordPrompt(false);
    });

    segmenter.onPasswordPrompt(() => {
      if (cancelled) return;
      // A password prompt is the `tier1` surface, driven solely by passwordPrompt
      // (it wins in deriveInputSurface). Do NOT set interactiveMode here: it would
      // pull the surface to `docked`, show the xterm over the PasswordPrompt widget,
      // and — since nothing cleanly resets it for this path — leave the surface
      // stuck off `composer` after the prompt clears (sudo never "kicks back").
      setPasswordPrompt(true);
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
        // A completed block means the foreground is the shell again, so no
        // raw-mode program can be running — clear interactiveMode so a stale
        // value can never strand the surface off `composer`.
        if (echoInteractiveTimerRef.current) {
          clearTimeout(echoInteractiveTimerRef.current);
          echoInteractiveTimerRef.current = null;
        }
        setInteractiveMode(false);
      }
    });

    const cleanupEcho = window.tai?.pty?.onEchoChange?.((evtId: number, e: { echo: boolean; icanon: boolean; passwordPrompt: boolean; interactiveProgram: boolean }) => {
      if (cancelled) return;
      if (evtId !== ptyId) return;
      setPasswordPrompt(e.passwordPrompt);
      // Raw-mode tty (REPLs like python/node/psql, plus full TUIs) — route
      // the card through xterm so the user sees keystrokes echo and can
      // use readline navigation/history.
      //
      // Debounce activation: commands like `brew` briefly disable ICANON for
      // progress bars, causing a false `interactiveProgram` signal. Require
      // the raw-mode state to persist before flipping the surface to `docked`.
      // A real REPL/TUI stays in raw mode indefinitely, so a short window is
      // enough to filter the transient toggles while keeping the input surface
      // snappy. Deactivation is immediate so the surface snaps back to
      // `composer` the moment the child restores canonical mode or exits.
      if (e.interactiveProgram) {
        if (!interactiveModeRef.current && !echoInteractiveTimerRef.current) {
          echoInteractiveTimerRef.current = setTimeout(() => {
            echoInteractiveTimerRef.current = null;
            setInteractiveMode(true);
            setInteractiveFullscreen(false);
          }, 500);
        }
      } else {
        if (echoInteractiveTimerRef.current) {
          clearTimeout(echoInteractiveTimerRef.current);
          echoInteractiveTimerRef.current = null;
        }
        setInteractiveMode(false);
      }
    });

    const cleanupAutoAuth = window.tai?.pty?.onAutoAuth?.((id: number) => {
      if (cancelled) return;
      if (id !== ptyId) return;
      // A cached sudo auto-fill happened in the main process: the termios
      // echo-change widget was suppressed there, but the text-driven
      // BlockSegmenter prompt may still have fired — dismiss it.
      setPasswordPrompt(false);
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
      cleanupAutoAuth?.();
      if (echoInteractiveTimerRef.current) {
        clearTimeout(echoInteractiveTimerRef.current);
        echoInteractiveTimerRef.current = null;
      }
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

  // displayQuestion: what the AI card shows as the user's question (and what
  // history picks up) when the actual prompt carries framing/context.
  const handleAIRequest = useCallback((prompt: string, displayQuestion?: string) => {
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

    setDisplayItems(prev => capDisplayItems([...prev,
      { type: 'ai' as const, id: aiId, question: displayQuestion ?? prompt, content: '', suggestedCommands: [], streaming: true, remote: eff.isRemote },
    ]));

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
          setDisplayItems(prev => capDisplayItems([...prev, {
            type: 'ai' as const,
            id: currentAiId,
            question: '',
            content: '',
            suggestedCommands: [],
            streaming: true,
            remote: eff.isRemote,
          }]));
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
        setDisplayItems(prev => capDisplayItems([...prev, {
          type: 'ai' as const,
          id: nextBlockId(),
          question: '',
          content: `**SSH connection failed:** ${msg.error}${hint}\n\nAI commands will run locally. Use key-based SSH auth for remote AI support.`,
          suggestedCommands: [],
          streaming: false,
          entries: [{ kind: 'text' as const, text: `**SSH connection failed:** ${msg.error}${hint}\n\nAI commands will run locally.` }],
        }]));
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
        beginSession(display);
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
      // Clear stale zero-state so the ghost suggestion isn't retained between
      // commands. The new values will be populated once the next block finalizes.
      setLastFinalizedCmd(undefined);
      setLastFinalizedExit(undefined);
      setEditValue(undefined);
    } else if (aiWorking || isAiActive()) {
      setQueuedPrompts(prev => addQueuedPrompt(prev, value));
      setEditValue('');
    } else {
      handleAIRequest(value);
    }
  }, [inputMode, hasActiveBlock, executeCommand, promptInfo, aiWorking, handleAIRequest, beginSession]);

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
    beginSession(display);
    setDisplayItems(prev => capDisplayItems([...prev, { type: 'command' as const, block: pendingBlock, active: true }]));
    executeCommand(command);
  }, [executeCommand, promptInfo, beginSession]);
  useEffect(() => { rerunRef.current = handleRerun; }, [handleRerun]);

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
      // Persist to disk so the setting survives app restarts.
      const obj: Record<string, RememberedHost> = {};
      remoteAiMemory.current.forEach((v, k) => { obj[k] = v; });
      window.tai?.config?.set('remote.rememberedHosts', obj);
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
      // Target-aware instead of a blanket interactive-mode bail: the xterm
      // and single-line inputs forward their own keys (double-handling would
      // send two SIGINTs); anywhere else — including during a raw-mode
      // session with focus on the page — the chord must still work, or
      // Ctrl+C appears to need two presses.
      const keyTarget = classifyKeyTarget(e.target);
      if (keyTarget !== 'page') return;

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

      // Cmd/Ctrl-K: open command palette (page-level focus only — not from xterm)
      if (e.key === 'k' && (e.metaKey || e.ctrlKey) && !e.shiftKey) {
        e.preventDefault();
        const now = Date.now();
        const histItems: PaletteItem[] = Object.values(commandIndex.stats)
          .sort((a, b) => frecency(b, now, cwd) - frecency(a, now, cwd))
          .slice(0, 30)
          .map(s => ({ id: `h:${s.command}`, label: s.command, value: s.command, source: 'history' as const }));
        const cmdItems: PaletteItem[] = getCommandNames().map(name => ({
          id: `c:${name}`, label: name, value: name, source: 'command' as const,
        }));
        const cmdSet = new Set(cmdItems.map(c => c.value));
        const dedupedHist = histItems.filter(h => !cmdSet.has(h.value));
        Promise.resolve(window.tai?.workflows?.get?.() ?? []).then((wfRaw: Workflow[]) => {
          const wfItems: PaletteItem[] = wfRaw.map(w => ({
            id: `w:${w.id}`, label: w.name, value: w.command, source: 'workflow' as const, description: w.description,
          }));
          // Deduplicate history against commands
          setPaletteItems([...wfItems, ...dedupedHist, ...cmdItems]);
          setPaletteOpen(true);
        });
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [visible, ptyId, handleStopAI, commandIndex, cwd]);

  useEffect(() => {
    if (!visible) return;
    const handleFocus = () => {
      if (!altScreenVisible && !awaitingInput && !passwordPrompt) inputRef.current?.focus();
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [visible, altScreenVisible, awaitingInput, passwordPrompt]);

  const surface = deriveInputSurface({
    altScreenVisible, interactiveMode, interactiveFullscreen, awaitingInput, passwordPrompt,
    rootedSession: !!(activeSession?.rooted && hasActiveBlock),
    // Windows (ConPTY) has no termios / /proc, so the signals above never fire;
    // fall back to the live terminal whenever a command is running so the user
    // can type into a program that's waiting for input.
    isWindows: window.tai?.system?.platform === 'win32',
    commandRunning: hasActiveBlock,
  });

  // Session chrome only for genuinely rooted/agent sessions — a quick oneshot
  // that briefly pins (tier1 prompt etc.) keeps its normal prompt header.
  const sessionForCard = activeSession && (activeSession.rooted || activeSession.kind === 'agent')
    ? activeSession
    : null;
  const handleSessionStop = useCallback(() => {
    if (ptyId !== null) window.tai?.pty?.write(ptyId, '\x03');
  }, [ptyId]);
  const handleSessionRestart = useCallback(() => {
    const sess = activeSessionRef.current;
    if (!sess || ptyId === null) return;
    pendingRestartRef.current = sess.command;
    window.tai?.pty?.write(ptyId, '\x03');
  }, [ptyId]);

  const handlePalettePick = useCallback((item: PaletteItem, runNow: boolean) => {
    setPaletteOpen(false);
    const params = parseParams(item.value);
    if (params.length > 0) {
      // Show the param dialog. We need a Workflow-shaped object.
      setWfDialog({ id: item.id, name: item.label, command: item.value, description: item.description });
      return;
    }
    // Insert into composer (paste) or run immediately
    if (runNow) {
      handleSubmit(item.value);
    } else {
      // Call insertValue directly on the TerminalInput imperative ref so that
      // repeated identical picks always update the composer — React 18 batching
      // would collapse a setEditValue(undefined)+setEditValue(same) double-call
      // into a single commit, making the initialValue useEffect a no-op.
      inputRef.current?.insertValue(item.value);
    }
  }, [handleSubmit]);

  const handleWorkflowRun = useCallback((command: string, runNow: boolean) => {
    setWfDialog(null);
    if (runNow) {
      handleSubmit(command);
    } else {
      // Same imperative-ref approach as handlePalettePick: avoids batching issue
      // on repeated identical workflow substitutions.
      inputRef.current?.insertValue(command);
    }
  }, [handleSubmit]);

  useEffect(() => {
    const target = focusTargetFor(surface);
    if (target === 'composer') {
      requestAnimationFrame(() => inputRef.current?.focus());
    } else if (target === 'xterm') {
      inputRef.current?.blur();
      requestAnimationFrame(() => hiddenXtermRef.current?.focus());
    } else {
      // tier1: the card's own line/password input self-focuses (CommandBlock effect).
      inputRef.current?.blur();
    }
  }, [surface]);

  const isRemote = promptInfo?.isRemote ?? false;
  const sessionHistory = displayItems
    .filter(item => {
      if (item.type === 'command') return item.block.isRemote === isRemote;
      if (item.type === 'ai') return !isRemote;
      return false;
    })
    .map(item => item.type === 'command' ? item.block.command : (item as DisplayItem & { type: 'ai' }).question);
  const baseHistory = isRemote ? remoteHistory : shellHistory;
  const inputHistory = assembleInputHistory(baseHistory, sessionHistory);

  const handleSendInput = useCallback((data: string) => {
    if (ptyId === null) return;
    window.tai?.pty?.write(ptyId, data);
  }, [ptyId]);

  // Stable identity: an inline closure here would defeat memo(CommandBlock)
  // for every card on every session render.
  const handlePasswordDone = useCallback(() => setPasswordPrompt(false), []);

  // Find-in-blocks (Ctrl/Cmd+F) and block navigation (Ctrl/Cmd+Up/Down),
  // visible tab only.
  const sessionRootRef = useRef<HTMLDivElement>(null);
  const findFlashTimerRef = useRef<number | null>(null);
  const navItemIdRef = useRef<string | null>(null);
  const handleFindNavigate = useCallback((itemId: string) => {
    const el = sessionRootRef.current?.querySelector(`[data-item-id="${itemId}"]`) as HTMLElement | null;
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior });
    el.classList.add('tai-find-flash');
    if (findFlashTimerRef.current) window.clearTimeout(findFlashTimerRef.current);
    findFlashTimerRef.current = window.setTimeout(() => el.classList.remove('tai-find-flash'), 1200);
  }, []);
  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setFindOpen(true);
        return;
      }
      // Warp-style block jumping: Ctrl/Cmd+Up walks back through command
      // blocks, Ctrl/Cmd+Down walks forward. Reuses the finder's flash.
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        const els = Array.from(
          sessionRootRef.current?.querySelectorAll('[data-item-id]') ?? [],
        ) as HTMLElement[];
        if (els.length === 0) return;
        e.preventDefault();
        let idx = els.findIndex(el => el.dataset.itemId === navItemIdRef.current);
        if (idx === -1) idx = els.length; // first press starts at the newest block
        idx = e.key === 'ArrowUp' ? Math.max(0, idx - 1) : Math.min(els.length - 1, idx + 1);
        const id = els[idx].dataset.itemId;
        if (!id) return;
        navItemIdRef.current = id;
        handleFindNavigate(id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, handleFindNavigate]);

  const handleFindClose = useCallback(() => setFindOpen(false), []);

  // Debounced persistence of finished blocks for next-launch restore.
  useEffect(() => {
    const t = window.setTimeout(() => persistBlocks(tabId, displayItems), 500);
    return () => window.clearTimeout(t);
  }, [displayItems, tabId]);

  const showFullscreenInteractive = surface === 'fullscreen' && !altScreenVisible;
  // Surface-driven: the xterm renders only for `docked` (portaled into the
  // pinned block) and `fullscreen`. Crucially NOT for `tier1` — a password
  // prompt sets interactiveMode=true, so the old `|| interactiveMode` formula
  // rendered the fallback xterm over the PasswordPrompt widget and stole its
  // keystrokes (masked dots never updated).
  const showXterm = shouldShowXterm(surface);
  // When remote-AI is active, keep the composer usable during a foreground
  // command (e.g. the interactive ssh) — AI input is out-of-band from the PTY.
  // Shell submits still queue (handled in the submit path); password/awaiting locks stay.
  const remoteAiActive = remoteAi.mode === 'watch' || remoteAi.mode === 'run';
  // The active interactive block (Tier 2 / Tier 1) is pinned to the bottom region.
  const isPinned = pinnedActiveBlock(surface);
  const showComposer = composerVisible(surface) && !showXterm;
  const blockInputLocked = awaitingInput || passwordPrompt;
  const inputDisabled = blockInputLocked || (hasActiveBlock && !passwordPrompt && !remoteAiActive);
  const activeBodyMode: import('@/types').BlockBodyMode =
    passwordPrompt ? 'password'
    : (altScreenVisible || interactiveMode) ? 'interactive'
    : 'output';

  // While docked/tier1/rooted, the trailing active command block is rendered
  // in the bottom-pinned region (Personality 2), not inside the scrolling
  // history. Found by scanning back past trailing AI items: a session side
  // conversation appends 'ai' items after the active command, which must not
  // un-pin the live card.
  let lastActiveCommand: (DisplayItem & { type: 'command' }) | null = null;
  for (let i = displayItems.length - 1; i >= 0; i--) {
    const it = displayItems[i];
    if (it.type === 'command') {
      if (it.active) lastActiveCommand = it;
      break;
    }
    if (it.type !== 'ai') break;
  }
  // Trailing AI items form the session side conversation while a live
  // session exists (pinned card OR a rooted session living in the
  // scrollback): shown in the side panel, hidden from history for the
  // duration (they drop back into the normal stream when the session ends).
  const pinnedBlock = isPinned && lastActiveCommand ? lastActiveCommand : null;
  const sessionInList = !isPinned && !!sessionForCard && !!lastActiveCommand;
  const sideChatItems: Array<DisplayItem & { type: 'ai' }> = [];
  if (pinnedBlock || sessionInList) {
    for (let i = displayItems.length - 1; i >= 0; i--) {
      const it = displayItems[i];
      if (it.type !== 'ai') break;
      sideChatItems.unshift(it);
    }
  }
  const historyItems = (pinnedBlock || sideChatItems.length > 0)
    ? displayItems.filter(i => i !== pinnedBlock && !(sideChatItems as DisplayItem[]).includes(i))
    : displayItems;

  const handleSessionAIPrompt = useCallback((text: string) => {
    const sess = activeSessionRef.current;
    const pendingItem = displayItemsRef.current.find(
      (i): i is DisplayItem & { type: 'command' } => i.type === 'command' && i.block.id === 'pending',
    );
    setSideChatOpen(true);
    handleAIRequestRef.current(
      pendingItem ? buildSessionAiPrompt(text, pendingItem.block, sess?.port ?? null) : text,
      text,
    );
  }, []);

  return (
    <div ref={sessionRootRef} style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0, position: 'relative' }}>
      <SudoCacheBadge
        cached={sudoCache.cached}
        flash={sudoCache.flash}
        onForget={() => window.tai?.pty?.forgetSecret?.()}
      />
      {findOpen && (
        <BlockFinder
          items={historyItems}
          onClose={handleFindClose}
          onNavigate={handleFindNavigate}
        />
      )}
      {paletteOpen && (
        <CommandPalette
          open={paletteOpen}
          items={paletteItems}
          onPick={handlePalettePick}
          onClose={() => setPaletteOpen(false)}
        />
      )}
      {wfDialog && (
        <WorkflowRunDialog
          workflow={wfDialog}
          onRun={handleWorkflowRun}
          onCancel={() => setWfDialog(null)}
        />
      )}
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
      {/* Rooted sessions live in the scrollback: one continuous scroll for
          history + live output. The session side conversation docks as a
          right-hand column beside the whole stream. */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'stretch', gap: 10 }}>
        <BlockList
          items={historyItems}
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
          onPasswordDone={handlePasswordDone}
          onInteractiveContainerRef={setInteractivePortalTarget}
          sessionRemoteSince={remoteSinceRef.current}
          sessionKind={sessionInList ? sessionForCard?.kind : undefined}
          port={sessionInList ? sessionForCard?.port : undefined}
          onSessionStop={sessionInList ? handleSessionStop : undefined}
          onSessionRestart={sessionInList && sessionForCard?.kind !== 'agent' ? handleSessionRestart : undefined}
          onAIPrompt={sessionInList ? handleSessionAIPrompt : undefined}
          activeHeaderExtra={sessionInList && eff.isRemote && remoteAi.target ? (
            <RemoteAiPill
              view={pillView(remoteAi)}
              onEnable={handleEnableRemoteAi}
              onSetMode={handleSetRemoteAiMode}
              onDismiss={handleDismissRemoteAi}
            />
          ) : undefined}
        />
        {sessionInList && sideChatOpen && sideChatItems.length > 0 && (
          <SessionSideChat
            items={sideChatItems}
            onAsk={handleSessionAIPrompt}
            onClose={() => setSideChatOpen(false)}
            onCopy={handleCopy}
            onRunCommand={(cmd) => { aiSuggestedCommands.current.add(cmd); handleRerun(cmd); }}
            onStopAI={handleStopAI}
            aiProvider={aiProvider}
          />
        )}
      </div>
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
      {isPinned && pinnedBlock && (
        /* Match the block list's geometry: 14px padding plus the 14px
           scrollbar gutter the list always reserves on the right, so the
           pinned live card's edges line up exactly with history cards.
           Row layout: live card + optional AI side conversation. */
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'stretch', gap: 10, minHeight: 0, maxHeight: '76vh', padding: '0 28px 0 14px' }}>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <CommandBlock
            block={pinnedBlock.block}
            active
            isActive
            awaitingInput={awaitingInput}
            cwd={cwd}
            bodyMode={activeBodyMode}
            ptyId={ptyId ?? undefined}
            docked={pinnedActiveBlock(surface)}
            sessionRemote={eff.isRemote}
            onCopy={handleCopy}
            onAskAI={handleAskAI}
            onRerun={handleRerun}
            onSendInput={handleSendInput}
            onPasswordDone={handlePasswordDone}
            onInteractiveContainerRef={setInteractivePortalTarget}
            sessionKind={sessionForCard?.kind}
            port={sessionForCard?.port}
            onStop={sessionForCard ? handleSessionStop : undefined}
            onRestart={sessionForCard && sessionForCard.kind !== 'agent' ? handleSessionRestart : undefined}
            onAIPrompt={sessionForCard ? handleSessionAIPrompt : undefined}
            headerExtra={
              eff.isRemote && remoteAi.target ? (
                <RemoteAiPill
                  view={pillView(remoteAi)}
                  onEnable={handleEnableRemoteAi}
                  onSetMode={handleSetRemoteAiMode}
                  onDismiss={handleDismissRemoteAi}
                />
              ) : undefined
            }
          />
          </div>
          {sideChatOpen && sideChatItems.length > 0 && (
            <SessionSideChat
              items={sideChatItems}
              onAsk={handleSessionAIPrompt}
              onClose={() => setSideChatOpen(false)}
              onCopy={handleCopy}
              onRunCommand={(cmd) => { aiSuggestedCommands.current.add(cmd); handleRerun(cmd); }}
              onStopAI={handleStopAI}
              aiProvider={aiProvider}
            />
          )}
        </div>
      )}
      {showComposer && (
        <div style={{ flexShrink: 0, opacity: inputDisabled ? (blockInputLocked ? 0.3 : 0.5) : 1, pointerEvents: blockInputLocked ? 'none' : 'auto', transition: 'opacity 0.15s', cursor: inputDisabled && !blockInputLocked ? 'not-allowed' : undefined }}>
          <TerminalInput
            ref={inputRef}
            onSubmit={handleSubmit}
            mode={inputMode}
            onModeChange={handleInputModeChange}
            cwd={cwd}
            commandIndex={commandIndex}
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
            lastCommand={lastFinalizedCmd}
            lastExitCode={lastFinalizedExit}
            aiNextCommandRefine={aiNextCommandRefine}
            onRequestAiSuggestion={singleShotAi}
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
