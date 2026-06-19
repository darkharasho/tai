import { useState, useRef, useEffect, useImperativeHandle, forwardRef, useMemo } from 'react';
import { predictCommandIndexed } from '@/hooks/useGhostText';
import type { CommandIndex } from '@/utils/commandIndex';
import { predictNextCommand, type NextCommandCtx } from '@/utils/nextCommand';
import { classifyInput, FLIP_THRESHOLD } from '@/utils/commandDetector';
import { stripForceShellPrefix, shouldShowAutoBadge } from '@/utils/inputModeUx';
import { buildNextCommandPrompt, extractCommand } from '@/utils/aiNextCommand';
import styles from './TerminalInput.module.css';
import { ShieldCheck, ShieldOff } from 'lucide-react';
import type { AIProvider, TrustLevel } from '@/types';
import type { PillView, RemoteAiMode } from '@/utils/remoteAiSession';

const PERM_LABELS: Record<AIProvider, Record<TrustLevel, string>> = {
  claude: { 'ask': 'Default', 'approve-edits': 'Auto Edits', 'bypass': 'Bypass' },
  codex: { 'ask': 'Auto', 'approve-edits': 'Read-only', 'bypass': 'Full Access' },
  gemini: { 'ask': 'Default', 'approve-edits': 'Auto Edit', 'bypass': 'Yolo' },
};

const GHOST_MIN_PREFIX = 2;

export function zeroStateSuggestion(value: string, mode: string, ctx: NextCommandCtx): string | null {
  if (value.length > 0 || mode !== 'shell' || !ctx.lastCommand) return null;
  return predictNextCommand(ctx);
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent);

export interface TerminalInputHandle {
  paste: (text: string) => void;
  focus: () => void;
  blur: () => void;
}

function stripPromptGlyphs(text: string): string {
  return text
    .replace(/[\uE0A0-\uE0D4\uE200-\uE2A9\uE5FA-\uE6B5\uE700-\uE7C5\uF000-\uFD46\uDB80-\uDBFF][\uDC00-\uDFFF]?/g, '')
    .replace(/[^\x20-\x7E\u00A0-\u00FF\u0100-\u024F\u2000-\u206F\u276F]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function extractPromptParts(promptText: string): { user: string; path: string } {
  const cleaned = stripPromptGlyphs(promptText);
  const userHostMatch = cleaned.match(/(\w[\w.-]*)@(\w[\w.-]*)/);
  if (userHostMatch) {
    const userHost = `${userHostMatch[1]}@${userHostMatch[2]}`;
    const afterHost = cleaned.slice(cleaned.indexOf(userHostMatch[0]) + userHostMatch[0].length);
    const pathMatch = afterHost.match(/\s*(~[^\s$#%]*|\/[^\s$#%]*)/);
    return { user: userHost, path: pathMatch ? pathMatch[1] : '' };
  }
  const match = cleaned.match(/(~[^\s$#%]*|\/[^\s$#%]*)/);
  if (match) {
    const before = cleaned.slice(0, cleaned.indexOf(match[0])).replace(/[\$#%>@:\s]+$/, '').trim();
    return { user: before, path: match[1] };
  }
  const clean = cleaned.replace(/[\$#%>\s]+$/, '').trim();
  return { user: clean, path: '' };
}

type InputMode = 'shell' | 'ai';

interface TerminalInputProps {
  onSubmit: (value: string) => void;
  mode: InputMode;
  onModeChange: (mode: InputMode) => void;
  disabled?: boolean;
  cwd: string;
  commandIndex: CommandIndex;
  promptInfo?: { text: string; isRemote: boolean; sshTarget?: string } | null;
  shellIntegrated?: boolean;
  history?: string[];
  onClear?: () => void;
  initialValue?: string;
  remoteAiView?: PillView;
  onEnableRemoteAi?: () => void;
  onSetRemoteAiMode?: (mode: RemoteAiMode) => void;
  onDismissRemoteAi?: () => void;
  aiProvider?: AIProvider;
  trustLevel?: TrustLevel;
  onTrustLevelChange?: (level: TrustLevel) => void;
  lastCommand?: string;
  lastExitCode?: number;
  aiNextCommandRefine?: boolean;
  /** Called with a prompt string when AI next-command refine is enabled and a zero-state suggestion is showing.
   *  The caller should resolve with the raw AI text response (or reject/throw to cancel silently). */
  onRequestAiSuggestion?: (prompt: string) => Promise<string>;
}

interface RemoteAiPillProps {
  view: PillView;
  onEnable: () => void;
  onSetMode: (mode: RemoteAiMode) => void;
  onDismiss: () => void;
}

export function RemoteAiPill({ view, onEnable, onSetMode, onDismiss }: RemoteAiPillProps) {
  if (view.kind === 'hidden') return null;
  if (view.kind === 'offer') {
    return (
      <span className={styles.raiOffer}>
        <span className={styles.raiSpark} aria-hidden="true">✦</span> AI · {view.target}
        <button className={styles.raiAction} onClick={(e) => { e.stopPropagation(); onEnable(); }}>enable</button>
        <button className={styles.raiX} title="Dismiss" aria-label="Dismiss" onClick={(e) => { e.stopPropagation(); onDismiss(); }}><span aria-hidden="true">✕</span></button>
      </span>
    );
  }
  if (view.kind === 'installing') {
    return <span role="status" className={styles.raiActive}><span aria-hidden="true">⟳</span> installing on {view.target}…</span>;
  }
  return (
    <span className={styles.raiActive} title={view.error ?? undefined}>
      <span className={styles.raiSeg}>
        <button
          className={`${styles.raiSegBtn} ${view.mode === 'watch' ? styles.raiWatchOn : ''}`}
          onClick={(e) => { e.stopPropagation(); onSetMode('watch'); }}
        ><span aria-hidden="true">👁</span> watch</button>
        <button
          className={`${styles.raiSegBtn} ${view.mode === 'run' ? styles.raiRunOn : ''}`}
          onClick={(e) => { e.stopPropagation(); onSetMode('run'); }}
        ><span aria-hidden="true">▸</span> run</button>
      </span>
      {view.error && <span className={styles.raiErr} title={view.error}>!</span>}
    </span>
  );
}

export const TerminalInput = forwardRef<TerminalInputHandle, TerminalInputProps>(function TerminalInput({ onSubmit, mode, onModeChange, disabled, cwd, commandIndex, promptInfo, shellIntegrated, history = [], onClear, initialValue, remoteAiView, onEnableRemoteAi, onSetRemoteAiMode, onDismissRemoteAi, aiProvider, trustLevel, onTrustLevelChange, lastCommand, lastExitCode, aiNextCommandRefine, onRequestAiSuggestion }, ref) {
  const [value, setValue] = useState(initialValue || '');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const historyIndexRef = useRef(-1);
  const savedInputRef = useRef('');
  const [manualOverride, setManualOverride] = useState(false);
  const [tabCompletions, setTabCompletions] = useState<string[]>([]);
  const [tabIndex, setTabIndex] = useState(-1);
  const tabPrefixRef = useRef('');
  const [aiRefinedSuggestion, setAiRefinedSuggestion] = useState<string | null>(null);
  const aiRefineTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aiRefineAbortRef = useRef<AbortController | null>(null);

  const prediction = useMemo(
    () => {
      if (mode !== 'shell') return null;
      if (value.length === 0) {
        // Zero-state: prefer AI refined suggestion when available, else heuristic.
        if (!lastCommand) return null;
        if (aiRefinedSuggestion) return aiRefinedSuggestion;
        return zeroStateSuggestion(value, mode, { lastCommand, lastExitCode, index: commandIndex });
      }
      // Prefix ghost text (P1): require at least GHOST_MIN_PREFIX chars and no newlines.
      if (value.length >= GHOST_MIN_PREFIX && !value.includes('\n')) {
        return predictCommandIndexed(value, commandIndex, Date.now(), cwd);
      }
      return null;
    },
    [mode, value, commandIndex, cwd, lastCommand, lastExitCode, aiRefinedSuggestion],
  );

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  useImperativeHandle(ref, () => ({
    paste: (text: string) => {
      setValue(prev => prev + text);
      inputRef.current?.focus();
    },
    focus: () => {
      inputRef.current?.focus();
    },
    blur: () => {
      inputRef.current?.blur();
    },
  }));

  useEffect(() => {
    if (initialValue !== undefined) setValue(initialValue);
  }, [initialValue]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [mode]);

  // Debounced AI refine: only fires when the flag is on, composer is empty (zero-state),
  // a heuristic suggestion exists, and a callback is provided. Cancels on any keystroke /
  // non-empty value. Flag off → never calls AI.
  useEffect(() => {
    // Clear any pending refined suggestion whenever value changes.
    if (value.length > 0) {
      setAiRefinedSuggestion(null);
    }

    if (
      !aiNextCommandRefine ||
      !onRequestAiSuggestion ||
      value.length > 0 ||
      mode !== 'shell' ||
      !lastCommand
    ) {
      // Cancel any in-flight debounce / request when conditions no longer hold.
      if (aiRefineTimerRef.current !== null) {
        clearTimeout(aiRefineTimerRef.current);
        aiRefineTimerRef.current = null;
      }
      if (aiRefineAbortRef.current) {
        aiRefineAbortRef.current.abort();
        aiRefineAbortRef.current = null;
      }
      return;
    }

    // Conditions met: debounce the AI call by 400 ms.
    if (aiRefineTimerRef.current !== null) clearTimeout(aiRefineTimerRef.current);
    aiRefineTimerRef.current = setTimeout(() => {
      aiRefineTimerRef.current = null;
      const abortController = new AbortController();
      aiRefineAbortRef.current = abortController;

      const prompt = buildNextCommandPrompt({
        lastCommand,
        recentCommands: history,
        cwd,
      });

      onRequestAiSuggestion(prompt)
        .then((aiText) => {
          if (abortController.signal.aborted) return;
          const cmd = extractCommand(aiText);
          // Only replace if the composer is still empty.
          if (cmd) setAiRefinedSuggestion(cmd);
        })
        .catch(() => {
          // Silently discard errors (cancelled or provider error).
        })
        .finally(() => {
          if (aiRefineAbortRef.current === abortController) aiRefineAbortRef.current = null;
        });
    }, 400);

    return () => {
      if (aiRefineTimerRef.current !== null) {
        clearTimeout(aiRefineTimerRef.current);
        aiRefineTimerRef.current = null;
      }
      aiRefineAbortRef.current?.abort();
      aiRefineAbortRef.current = null;
    };
  }, [aiNextCommandRefine, onRequestAiSuggestion, value, mode, lastCommand, history, cwd]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Tab' && e.shiftKey) {
      e.preventDefault();
      setManualOverride(true);
      onModeChange(mode === 'shell' ? 'ai' : 'shell');
      return;
    }
    if (e.key === 'Tab' && !e.shiftKey && mode === 'shell') {
      e.preventDefault();
      if (prediction) {
        setValue(prediction);
        setTabCompletions([]);
        setTabIndex(-1);
        tabPrefixRef.current = '';
        return;
      }
      const text = value;
      if (!text) return;

      if (tabCompletions.length > 1 && tabPrefixRef.current) {
        const next = (tabIndex + 1) % tabCompletions.length;
        setTabIndex(next);
        setValue(tabPrefixRef.current + tabCompletions[next]);
        return;
      }

      window.tai?.pty?.tabComplete(text, cwd).then((completions: string[]) => {
        if (completions.length === 0) return;
        const lastWord = text.split(/\s+/).pop() || '';
        const prefix = text.slice(0, text.length - lastWord.length);
        if (completions.length === 1) {
          const c = completions[0];
          setValue(prefix + c + (c.endsWith('/') ? '' : ' '));
          setTabCompletions([]);
          setTabIndex(-1);
          tabPrefixRef.current = '';
        } else {
          let common = completions[0];
          for (let i = 1; i < completions.length; i++) {
            let j = 0;
            while (j < common.length && j < completions[i].length && common[j] === completions[i][j]) j++;
            common = common.slice(0, j);
          }
          if (common.length > lastWord.length) {
            setValue(prefix + common);
            setTabCompletions([]);
            setTabIndex(-1);
            tabPrefixRef.current = '';
          } else {
            setTabCompletions(completions);
            setTabIndex(0);
            tabPrefixRef.current = prefix;
            setValue(prefix + completions[0]);
          }
        }
      });
      return;
    }
    if (e.key === 'l' && e.ctrlKey && !e.shiftKey) {
      e.preventDefault();
      onClear?.();
      return;
    }
    if (e.key === 'u' && e.ctrlKey && !e.shiftKey) {
      e.preventDefault();
      const pos = inputRef.current?.selectionStart ?? value.length;
      setValue(value.slice(pos));
      requestAnimationFrame(() => inputRef.current?.setSelectionRange(0, 0));
      return;
    }
    if (e.key === 'w' && e.ctrlKey && !e.shiftKey) {
      e.preventDefault();
      const pos = inputRef.current?.selectionStart ?? value.length;
      const before = value.slice(0, pos);
      const trimmed = before.replace(/\s+$/, '');
      const lastSpace = trimmed.lastIndexOf(' ');
      const newBefore = lastSpace === -1 ? '' : value.slice(0, lastSpace + 1);
      const after = value.slice(pos);
      setValue(newBefore + after);
      const newPos = newBefore.length;
      requestAnimationFrame(() => inputRef.current?.setSelectionRange(newPos, newPos));
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setValue('');
      setManualOverride(false);
      return;
    }
    if (e.key === 'ArrowRight' && prediction && inputRef.current?.selectionStart === value.length) {
      e.preventDefault();
      setValue(prediction);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (history.length === 0) return;
      if (historyIndexRef.current === -1) savedInputRef.current = value;
      const nextIdx = Math.min(historyIndexRef.current + 1, history.length - 1);
      historyIndexRef.current = nextIdx;
      setValue(history[history.length - 1 - nextIdx]);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndexRef.current <= -1) return;
      const nextIdx = historyIndexRef.current - 1;
      historyIndexRef.current = nextIdx;
      if (nextIdx === -1) {
        setValue(savedInputRef.current);
      } else {
        setValue(history[history.length - 1 - nextIdx]);
      }
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && value.trim()) {
      e.preventDefault();
      onSubmit(value);
      setValue('');
      setManualOverride(false);
      historyIndexRef.current = -1;
      savedInputRef.current = '';
      setTabCompletions([]);
      setTabIndex(-1);
      tabPrefixRef.current = '';
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    // In AI mode, a leading '!' forces a one-off shell command: strip it,
    // lock to shell, and skip autodetect for this change.
    const forced = stripForceShellPrefix(mode, e.target.value);
    if (forced.forceShell) {
      setValue(forced.value);
      setTabCompletions([]);
      setTabIndex(-1);
      tabPrefixRef.current = '';
      setManualOverride(true);
      onModeChange('shell');
      return;
    }

    const newVal = forced.value;
    setValue(newVal);
    setTabCompletions([]);
    setTabIndex(-1);
    tabPrefixRef.current = '';

    const trimmed = newVal.trim();
    if (trimmed.length === 0) {
      // Clearing the field resumes autodetect for the next input.
      setManualOverride(false);
      if (mode !== 'shell') onModeChange('shell');
      return;
    }
    if (!manualOverride) {
      const { type, confidence } = classifyInput(trimmed, { currentMode: mode });
      if (confidence >= FLIP_THRESHOLD && type !== mode) {
        onModeChange(type);
      }
    }
  };

  const isAI = mode === 'ai';
  const showAutoBadge = shouldShowAutoBadge(value, manualOverride);
  const shortCwd = cwd.replace(/^\/var\/home\/[^/]+/, '~').replace(/^\/home\/[^/]+/, '~');
  const modKey = isMac ? '\u2318' : 'Ctrl+';

  let promptIsRemote = false;
  let userName = '';
  let promptPath = shortCwd;
  if (promptInfo?.text) {
    const cleaned = stripPromptGlyphs(promptInfo.text);
    const parts = extractPromptParts(cleaned);
    if (parts.user) userName = parts.user;
    if (parts.path) promptPath = parts.path;
  }
  if (promptInfo?.isRemote && promptInfo.sshTarget) {
    promptIsRemote = true;
    userName = promptInfo.sshTarget;
  }

  return (
    <div className={styles.wrapper}>
      {tabCompletions.length > 1 && (
        <div className={styles.tabPopup}>
          {tabCompletions.map((c, i) => (
            <div key={c} className={`${styles.tabItem} ${i === tabIndex ? styles.tabItemActive : ''}`}>
              {c}
            </div>
          ))}
        </div>
      )}
      <div className={`${styles.box} ${isAI ? styles.boxAi : ''} ${promptIsRemote ? styles.boxRemote : ''}`}>
        <div className={styles.row}>
          <span
            className={`${styles.integrationDot} ${shellIntegrated ? styles.integrationDotActive : ''}`}
            title={shellIntegrated
              ? 'Shell integration active \u2014 block boundaries are deterministic.'
              : 'Shell integration not detected \u2014 falling back to prompt-text heuristics. Block boundaries may be flaky.'}
            aria-label={shellIntegrated ? 'Shell integration active' : 'Shell integration not detected'}
          />
          {remoteAiView && onEnableRemoteAi && onSetRemoteAiMode && onDismissRemoteAi && (
            <RemoteAiPill
              view={remoteAiView}
              onEnable={onEnableRemoteAi}
              onSetMode={onSetRemoteAiMode}
              onDismiss={onDismissRemoteAi}
            />
          )}
          {isAI ? (
            <>
              <span className={styles.promptAi}>{'\u2726'}</span>
              <span className={styles.path}>{promptPath}</span>
            </>
          ) : (
            <>
              {userName && <span className={styles.user} style={promptIsRemote ? { color: 'var(--color-agent)' } : undefined}>{userName}</span>}
              <span className={styles.path}>{promptPath}</span>
              <span className={styles.dollar}>$</span>
            </>
          )}
          <div className={styles.fieldWrap}>
            {prediction && (
              <span className={styles.ghost} aria-hidden="true">
                <span style={{ visibility: 'hidden' }}>{value}</span>{prediction.slice(value.length)}
              </span>
            )}
            <textarea
              ref={inputRef}
              className={styles.field}
              value={value}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              placeholder={disabled ? 'Command running… (input queues)' : (isAI ? 'Ask AI...' : '')}
              spellCheck={false}
              autoComplete="off"
              rows={1}
            />
          </div>
          {isAI && aiProvider && trustLevel && onTrustLevelChange && (
            <button
              className={`${styles.permBadge} ${trustLevel === 'bypass' ? styles.permDanger : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                const levels: TrustLevel[] = ['ask', 'approve-edits', 'bypass'];
                const idx = levels.indexOf(trustLevel);
                onTrustLevelChange(levels[(idx + 1) % levels.length]);
              }}
              title={`Permissions: ${PERM_LABELS[aiProvider][trustLevel]}`}
            >
              {trustLevel === 'bypass'
                ? <ShieldOff size={12} />
                : <ShieldCheck size={12} />
              }
              <span className={styles.permLabel}>{PERM_LABELS[aiProvider][trustLevel]}</span>
            </button>
          )}
          <div className={styles.hint}>
            {showAutoBadge && (
              <span className={styles.autoBadge} title="Mode auto-detected — Shift+Tab to lock, ! to force shell">
                auto
              </span>
            )}
            <span className={styles.kbd}>Shift+Tab</span>
            <span className={styles.hintLabel}>{isAI ? 'Shell' : 'AI'}</span>
          </div>
        </div>
      </div>
    </div>
  );
});
