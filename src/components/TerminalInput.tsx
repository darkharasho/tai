import { useState, useRef, useEffect, useImperativeHandle, forwardRef, useMemo } from 'react';
import { predictCommand } from '@/hooks/useGhostText';
import { looksLikeShellCommand } from '@/utils/commandDetector';

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
  const match = cleaned.match(/^(\S+?)[@:]?\s*(~[^\s$#%]*|\/[^\s$#%]*)/);
  if (match) return { user: match[1], path: match[2] };
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
}

export const TerminalInput = forwardRef<TerminalInputHandle, TerminalInputProps>(function TerminalInput({ onSubmit, mode, onModeChange, disabled, cwd, promptInfo, history = [], onClear, initialValue }, ref) {
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
    <div className="tn-input-wrapper">
      {tabCompletions.length > 1 && (
        <div className="tn-tab-popup">
          {tabCompletions.map((c, i) => (
            <div key={c} className={`tn-tab-item ${i === tabIndex ? 'tn-tab-active' : ''}`}>
              {c}
            </div>
          ))}
        </div>
      )}
      <div className={`tn-input-box ${isAI ? 'tn-input-box-ai' : ''}`}>
        <div className="tn-input-row">
          {isAI ? (
            <>
              <span className="tn-input-prompt-ai">{'\u2726'}</span>
              <span className="tn-input-path">{promptPath}</span>
            </>
          ) : (
            <>
              {userName && <span className="tn-input-user" style={promptIsRemote ? { color: '#d4770c' } : undefined}>{userName}</span>}
              <span className="tn-input-path">{promptPath}</span>
              <span className="tn-input-dollar">$</span>
            </>
          )}
          <div className="tn-input-field-wrap">
            {prediction && (
              <span className="tn-input-ghost" aria-hidden="true">
                <span style={{ visibility: 'hidden' }}>{value}</span>{prediction.slice(value.length)}
              </span>
            )}
            <input
              ref={inputRef}
              className="tn-input-field"
              value={value}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              placeholder={isAI ? 'Ask AI...' : ''}
              disabled={disabled}
              spellCheck={false}
              autoComplete="off"
            />
          </div>
          <div className="tn-input-hint">
            <span className="tn-input-kbd">Shift+Tab</span>
            <span className="tn-input-hint-label">{isAI ? 'Shell' : 'AI'}</span>
          </div>
        </div>
      </div>

      <style>{`
        .tn-input-wrapper {
          padding: 8px 14px 10px;
          flex-shrink: 0;
        }
        .tn-input-box {
          position: relative;
          border-radius: 5px;
          background: var(--bg-input);
          overflow: visible;
        }
        .tn-input-box::before {
          content: '';
          position: absolute;
          inset: -1.5px;
          border-radius: 6.5px;
          padding: 1.5px;
          background: linear-gradient(135deg, var(--color-shell) 0%, #007a60 30%, #005a47 50%, #007a60 70%, var(--color-shell) 100%);
          background-size: 300% 300%;
          animation: tn-gradient-sweep 20s ease-in-out infinite alternate;
          -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
          -webkit-mask-composite: xor;
          mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
          mask-composite: exclude;
          pointer-events: none;
          z-index: 0;
          opacity: 0.5;
          transition: opacity 0.2s ease;
        }
        .tn-input-box:focus-within::before {
          opacity: 1;
        }
        .tn-input-box-ai::before {
          background: linear-gradient(135deg, var(--color-ai) 0%, #8b4dd4 30%, #6b35b0 50%, #8b4dd4 70%, var(--color-ai) 100%);
          background-size: 300% 300%;
          animation: tn-gradient-sweep 20s ease-in-out infinite alternate;
        }
        .tn-input-row {
          position: relative;
          z-index: 1;
          padding: 8px 12px;
          display: flex;
          align-items: center;
          gap: 8px;
          font-family: var(--font-mono);
          font-size: 13px;
        }
        .tn-input-user {
          color: var(--color-shell);
          flex-shrink: 0;
          font-size: 13px;
          font-weight: 500;
        }
        .tn-input-path {
          color: var(--color-info);
          flex-shrink: 0;
          font-size: 13px;
        }
        .tn-input-dollar {
          color: var(--text-muted);
          flex-shrink: 0;
        }
        .tn-input-prompt-ai {
          color: var(--color-ai);
          font-size: 14px;
          flex-shrink: 0;
        }
        .tn-input-field-wrap {
          flex: 1;
          position: relative;
          min-width: 0;
        }
        .tn-input-ghost {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          pointer-events: none;
          color: rgba(255, 255, 255, 0.15);
          font-family: var(--font-mono);
          font-size: 13px;
          white-space: pre;
          overflow: hidden;
        }
        .tn-input-field {
          position: relative;
          width: 100%;
          background: none;
          border: none;
          outline: none;
          color: var(--text-primary);
          font-family: var(--font-mono);
          font-size: 13px;
          min-width: 0;
        }
        .tn-input-field::placeholder {
          color: var(--text-muted);
        }
        .tn-input-hint {
          display: flex;
          align-items: center;
          gap: 4px;
          flex-shrink: 0;
          margin-left: auto;
        }
        .tn-input-kbd {
          color: var(--text-muted);
          font-size: 10px;
          border: 1px solid var(--border-subtle);
          padding: 1px 5px;
          border-radius: 3px;
          background: var(--bg-base);
        }
        .tn-input-hint-label {
          color: var(--text-muted);
          font-size: 10px;
        }
        .tn-tab-popup {
          background: var(--bg-elevated);
          border: 1px solid var(--border-subtle);
          border-radius: 5px;
          padding: 4px 0;
          margin-bottom: 4px;
          max-height: 200px;
          overflow-y: auto;
          font-family: var(--font-mono);
          font-size: 12px;
          display: flex;
          flex-wrap: wrap;
          gap: 0;
        }
        .tn-tab-item {
          padding: 3px 10px;
          color: var(--text-secondary);
          white-space: nowrap;
          border-radius: 3px;
          margin: 1px 3px;
        }
        .tn-tab-active {
          background: var(--color-shell);
          color: var(--bg-base);
        }
        @keyframes tn-gradient-sweep {
          0% { background-position: 0% 0%; }
          100% { background-position: 100% 100%; }
        }
      `}</style>
    </div>
  );
});
