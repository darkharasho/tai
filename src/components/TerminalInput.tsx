import { useState, useRef, useEffect, useImperativeHandle, forwardRef, useMemo } from 'react';
import { predictCommand } from '@/hooks/useGhostText';
import { looksLikeShellCommand } from '@/utils/commandDetector';
import styles from './TerminalInput.module.css';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent);

export interface TerminalInputHandle {
  paste: (text: string) => void;
  focus: () => void;
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
  promptInfo?: { text: string; isRemote: boolean; sshTarget?: string } | null;
  history?: string[];
  onClear?: () => void;
  initialValue?: string;
  remoteExecMode?: 'auto' | 'local';
  onRemoteExecModeChange?: (mode: 'auto' | 'local') => void;
}

export const TerminalInput = forwardRef<TerminalInputHandle, TerminalInputProps>(function TerminalInput({ onSubmit, mode, onModeChange, disabled, cwd, promptInfo, history = [], onClear, initialValue, remoteExecMode, onRemoteExecModeChange }, ref) {
  const [value, setValue] = useState(initialValue || '');
  const inputRef = useRef<HTMLInputElement>(null);
  const historyIndexRef = useRef(-1);
  const savedInputRef = useRef('');
  const manualOverrideRef = useRef(false);
  const [tabCompletions, setTabCompletions] = useState<string[]>([]);
  const [tabIndex, setTabIndex] = useState(-1);
  const tabPrefixRef = useRef('');

  const prediction = useMemo(
    () => mode === 'shell' && value.length >= 5 ? predictCommand(value, history) : null,
    [value, history, mode],
  );

  useImperativeHandle(ref, () => ({
    paste: (text: string) => {
      setValue(prev => prev + text);
      inputRef.current?.focus();
    },
    focus: () => {
      inputRef.current?.focus();
    },
  }));

  useEffect(() => {
    if (initialValue !== undefined) setValue(initialValue);
  }, [initialValue]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [mode]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Tab' && e.shiftKey) {
      e.preventDefault();
      manualOverrideRef.current = true;
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
      manualOverrideRef.current = false;
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
    if (e.key === 'Enter' && value.trim()) {
      e.preventDefault();
      onSubmit(value.trim());
      setValue('');
      manualOverrideRef.current = false;
      historyIndexRef.current = -1;
      savedInputRef.current = '';
      setTabCompletions([]);
      setTabIndex(-1);
      tabPrefixRef.current = '';
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVal = e.target.value;
    setValue(newVal);
    setTabCompletions([]);
    setTabIndex(-1);
    tabPrefixRef.current = '';
    if (!manualOverrideRef.current) {
      const trimmed = newVal.trim();
      if (trimmed.length === 0) {
        if (mode !== 'shell') onModeChange('shell');
      } else if (mode === 'shell' && !looksLikeShellCommand(trimmed)) {
        onModeChange('ai');
      } else if (mode === 'ai' && looksLikeShellCommand(trimmed)) {
        onModeChange('shell');
      }
    }
  };

  const isAI = mode === 'ai';
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
          {isAI ? (
            <>
              <span className={styles.promptAi}>{'\u2726'}</span>
              {promptIsRemote && onRemoteExecModeChange && (
                <button
                  className={styles.remoteToggle}
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoteExecModeChange(remoteExecMode === 'auto' ? 'local' : 'auto');
                  }}
                  title={remoteExecMode === 'auto' ? 'AI executes on remote host \u2014 click for local' : 'AI executes locally \u2014 click for remote'}
                >
                  {remoteExecMode === 'auto' ? 'Remote' : 'Local'}
                </button>
              )}
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
            <input
              ref={inputRef}
              className={styles.field}
              value={value}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              placeholder={isAI ? 'Ask AI...' : ''}
              disabled={disabled}
              spellCheck={false}
              autoComplete="off"
            />
          </div>
          <div className={styles.hint}>
            <span className={styles.kbd}>Shift+Tab</span>
            <span className={styles.hintLabel}>{isAI ? 'Shell' : 'AI'}</span>
          </div>
        </div>
      </div>
    </div>
  );
});
