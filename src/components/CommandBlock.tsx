import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { Copy, Check } from 'lucide-react';
import { ansiToHtml } from '@/utils/ansiToHtml';
import type { SegmentedBlock, BlockBodyMode } from '@/types';
import { PasswordPrompt } from './PasswordPrompt';
import styles from './CommandBlock.module.css';

const LONG_OUTPUT_LINES = 30;

function formatDuration(ms: number): string {
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
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

interface CommandBlockProps {
  block: SegmentedBlock;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  active?: boolean;
  awaitingInput?: boolean;
  aiSuggested?: boolean;
  cwd?: string;
  onCopy: (text: string) => void;
  onAskAI: (block: SegmentedBlock) => void;
  onRerun: (command: string) => void;
  onSendInput?: (data: string) => void;
  bodyMode?: BlockBodyMode;
  ptyId?: number;
  onPasswordDone?: () => void;
  isActive?: boolean;
}

export function CommandBlock({
  block,
  collapsed,
  onToggleCollapse,
  active,
  awaitingInput,
  aiSuggested,
  cwd,
  onCopy,
  onSendInput,
  bodyMode = 'output',
  ptyId,
  onPasswordDone,
  isActive,
}: CommandBlockProps) {
  const [showAll, setShowAll] = useState(false);
  const [copied, setCopied] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const interactiveRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (active && awaitingInput && onSendInput) {
      requestAnimationFrame(() => interactiveRef.current?.focus());
    }
  }, [active, awaitingInput, onSendInput]);

  const outputLines = block.output ? block.output.split('\n') : [];
  const isLong = outputLines.length > LONG_OUTPUT_LINES;
  const isClamped = isLong && !showAll && !active;
  const coloredOutput = useMemo(() => {
    const raw = block.rawOutput || block.output;
    return raw ? ansiToHtml(raw) : '';
  }, [block.rawOutput, block.output]);

  const handleOutputClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.tagName === 'A' && target.dataset.url) {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        window.tai?.shell?.openExternal(target.dataset.url);
      }
    }
  }, []);

  let { user, path } = extractPromptParts(block.promptText);
  if (!user && !path && cwd) {
    const shortCwd = cwd.replace(/^\/var\/home\/[^/]+/, '~').replace(/^\/home\/[^/]+/, '~');
    path = shortCwd;
  }
  const isRemote = block.isRemote;
  const modeColor = isRemote ? 'var(--color-agent)' : 'var(--color-shell)';

  if (collapsed) {
    return (
      <div className={styles.collapsed} onClick={() => onToggleCollapse?.()}>
        <span className={styles.promptUser} style={{ color: modeColor }}>{user}</span>
        {path && <span className={styles.promptPath}>{path}</span>}
        <span className={styles.promptSep}>$</span>
        <span className={styles.cmdDim}>{block.command}</span>
        <span className={styles.meta}>{formatDuration(block.duration)}</span>
      </div>
    );
  }

  return (
    <div
      className={styles.block}
      data-card-surface
      style={{ '--accent-color': modeColor } as React.CSSProperties}
      onClick={() => { if (active && awaitingInput && onSendInput) interactiveRef.current?.focus(); }}
    >
      <div className={styles.promptLine} onClick={() => onToggleCollapse?.()}>
        <div className={styles.promptLeft}>
          <span className={styles.promptUser} style={{ color: modeColor }}>{user}</span>
          {path && <span className={styles.promptPath}>{path}</span>}
          <span className={styles.promptSep}>$</span>
          <span className={styles.cmd}>{block.command}</span>
          {aiSuggested && <span className={styles.viaAi}>ai</span>}
        </div>
        <div className={styles.promptRight}>
          {active ? (
            awaitingInput ? (
              <span className={styles.awaiting}>
                <span className={styles.awaitingDot} />
                INPUT
              </span>
            ) : (
              <span className={styles.running} />
            )
          ) : (
            <>
              <span
                className={`${styles.copyBtn}${copied ? ` ${styles.copyBtnCopied}` : ''}`}
                title="Copy command"
                onClick={(e) => {
                  e.stopPropagation();
                  onCopy(block.command);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                {copied ? <Check size={11} /> : <Copy size={11} />}
              </span>
              <span className={styles.meta}>{formatDuration(block.duration)}</span>
            </>
          )}
        </div>
      </div>

      {bodyMode === 'password' && ptyId !== undefined && (
        <>
          <div
            className={styles.separator}
            style={{
              background: `linear-gradient(90deg, ${isRemote ? 'rgba(245,158,11,0.12)' : 'rgba(0,168,132,0.12)'}, transparent 60%)`,
            }}
          />
          <PasswordPrompt ptyId={ptyId} onDone={onPasswordDone ?? (() => {})} />
        </>
      )}

      {bodyMode === 'interactive' && (
        <>
          <div
            className={styles.separator}
            style={{
              background: `linear-gradient(90deg, ${isRemote ? 'rgba(245,158,11,0.12)' : 'rgba(0,168,132,0.12)'}, transparent 60%)`,
            }}
          />
          <div className={styles.interactiveBody} style={{ minHeight: 80, padding: '10px 16px', opacity: 0.6, fontStyle: 'italic', fontSize: 12 }}>
            (interactive program running…)
          </div>
        </>
      )}

      {bodyMode === 'output' && block.output && (
        <>
          <div
            className={styles.separator}
            style={{
              background: `linear-gradient(90deg, ${isRemote ? 'rgba(245,158,11,0.12)' : 'rgba(0,168,132,0.12)'}, transparent 60%)`,
            }}
          />
          <div className={styles.outputArea}>
            <div
              className={styles.output}
              style={isClamped ? { maxHeight: '300px', overflowY: 'hidden' } : undefined}
              dangerouslySetInnerHTML={{ __html: coloredOutput }}
              onClick={handleOutputClick}
            />
            {isLong && !active && (
              <div className={styles.showMore} onClick={() => setShowAll(v => !v)}>
                {showAll ? 'less' : `${outputLines.length} lines`}
              </div>
            )}
          </div>
        </>
      )}

      {bodyMode === 'output' && isActive && ptyId !== undefined && !awaitingInput && (
        <CardInput ptyId={ptyId} />
      )}

      {active && awaitingInput && onSendInput && (
        <input
          ref={interactiveRef}
          type="text"
          className={styles.interactiveInput}
          placeholder="Type input, Enter to send"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onSendInput(inputValue + '\r');
              setInputValue('');
            } else if (e.key === 'Escape') {
              e.preventDefault();
              setInputValue('');
            }
          }}
        />
      )}
    </div>
  );
}

function CardInput({ ptyId }: { ptyId: number }) {
  const [value, setValue] = useState('');
  return (
    <input
      className={styles.cardInput}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      placeholder="…input to running command"
      spellCheck={false}
      autoComplete="off"
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          window.tai?.pty?.write?.(ptyId, value + '\n');
          setValue('');
        } else if (e.key === 'c' && e.ctrlKey) {
          e.preventDefault();
          window.tai?.pty?.write?.(ptyId, '\x03');
        }
      }}
    />
  );
}
