import { useState, useMemo, useCallback, useRef, useEffect, useLayoutEffect, memo, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Copy, Check, GitBranch } from 'lucide-react';
import { ansiToHtml } from '@/utils/ansiToHtml';
import { headLines, tailLines } from '@/utils/outputWindow';
import { classifyExit } from '@/utils/exitStatus';
import { clampMenuPos } from '@/utils/menuPosition';
import type { SessionKind } from '@/utils/sessionKind';
import { isPinnedToBottom } from '@/utils/scrollPolicy';
import type { SegmentedBlock, BlockBodyMode } from '@/types';
import { PasswordPrompt } from './PasswordPrompt';
import styles from './CommandBlock.module.css';

const LONG_OUTPUT_LINES = 30;
// Live tail window for the active streaming card. Bounds both the per-frame
// ansiToHtml cost and the DOM size; the full output stays on the block for
// copy/AI/expand once the command finishes.
const MAX_ACTIVE_LINES = 500;

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
  onInteractiveContainerRef?: (el: HTMLDivElement | null) => void;
  /** True when the tab's AI session is on a remote host — forces the remote (orange) accent. */
  sessionRemote?: boolean;
  /** Render as the bottom-pinned live edge: cap the interactive body height + scroll. */
  docked?: boolean;
  /** Optional node rendered in the prompt-right header area (e.g. the remote-AI pill). */
  headerExtra?: ReactNode;
  /** Long-running session classification — switches the header to session chrome while active. */
  sessionKind?: SessionKind;
  /** Detected local port for the click-to-open chip. */
  port?: number | null;
  /** Session STOP/END (SIGINT). */
  onStop?: () => void;
  /** Session RESTART (SIGINT, then re-run once the block finalizes). */
  onRestart?: () => void;
}

/** Ticking elapsed-time chip for a live session card. */
function ElapsedChip({ startTime }: { startTime: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return <span className={styles.meta}>{formatDuration(Math.max(0, now - startTime))}</span>;
}

// Separator gradients depend only on the remote accent; hoisted so finished
// cards keep referentially-stable styles across streaming re-renders.
const SEPARATOR_STYLE_LOCAL = {
  background: 'linear-gradient(90deg, rgba(0,168,132,0.12), transparent 60%)',
} as const;
const SEPARATOR_STYLE_REMOTE = {
  background: 'linear-gradient(90deg, rgba(245,158,11,0.12), transparent 60%)',
} as const;

const REPL_ACTIVE_STYLE = {
  minHeight: '60vh',
  display: 'flex',
  flexDirection: 'column',
} as const;

// The bottom-pinned live card sits outside the scrolling history, so it must
// bound itself: card capped, output scrolls internally, stdin stays visible.
const PINNED_LIVE_STYLE = {
  maxHeight: '76vh',
  display: 'flex',
  flexDirection: 'column',
} as const;

const STOP_BTN_STYLE = {
  background: 'none',
  border: '1px solid rgba(255,255,255,0.18)',
  borderRadius: 4,
  color: 'var(--text-muted)',
  cursor: 'pointer',
  padding: '1px 8px',
  fontSize: 10,
  fontFamily: 'var(--font-mono)',
  marginLeft: 8,
  letterSpacing: '0.5px',
} as const;

export const CommandBlock = memo(function CommandBlock({
  block,
  collapsed,
  onToggleCollapse,
  active,
  awaitingInput,
  aiSuggested,
  cwd,
  onCopy,
  onAskAI,
  onRerun,
  onSendInput,
  bodyMode = 'output',
  ptyId,
  onPasswordDone,
  isActive,
  onInteractiveContainerRef,
  sessionRemote,
  docked,
  headerExtra,
  sessionKind,
  port,
  onStop,
  onRestart,
}: CommandBlockProps) {
  const [showAll, setShowAll] = useState(false);
  const [copied, setCopied] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const interactiveRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const openMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setMenuPos({ x: e.clientX, y: e.clientY });
  }, []);

  // Clamp to the viewport once the menu has real dimensions; right-clicks
  // near the bottom/right edge would otherwise push it off-screen. Runs
  // again after its own setState, where the equality guard settles it.
  useLayoutEffect(() => {
    if (!menuPos || !menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const clamped = clampMenuPos(menuPos, rect, { width: window.innerWidth, height: window.innerHeight });
    if (clamped.x !== menuPos.x || clamped.y !== menuPos.y) setMenuPos(clamped);
  }, [menuPos]);

  useEffect(() => {
    if (!menuPos) return;
    // Target-based dismissal: the menu lives in a body portal, so native
    // events from it still bubble to window — check containment instead of
    // relying on stopPropagation.
    const close = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      setMenuPos(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuPos(null); };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [menuPos]);

  useEffect(() => {
    if (active && awaitingInput && onSendInput) {
      requestAnimationFrame(() => interactiveRef.current?.focus());
    }
  }, [active, awaitingInput, onSendInput]);

  const outputLineCount = useMemo(
    () => (block.output ? block.output.split('\n').length : 0),
    [block.output],
  );
  const isLong = outputLineCount > LONG_OUTPUT_LINES;
  const isClamped = isLong && !showAll && !active;
  // Only the windowed slice is converted to HTML and materialized in the DOM:
  // active cards show the live tail, clamped cards the head (the visual clip
  // used to hide the rest while the full HTML still sat in the DOM).
  const coloredOutput = useMemo(() => {
    const raw = block.rawOutput || block.output;
    if (!raw) return '';
    const windowed = active
      ? tailLines(raw, MAX_ACTIVE_LINES).text
      : isClamped
        ? headLines(raw, LONG_OUTPUT_LINES).text
        : raw;
    return ansiToHtml(windowed);
  }, [block.rawOutput, block.output, active, isClamped]);

  // Pinned to the bottom region (outside the scrolling history): the card
  // must cap its own height and scroll output internally, or large output
  // pushes the stdin line off-screen with no way to reach it. Hooks live
  // above the collapsed early-return.
  const pinnedLive = !!docked && !!active && bodyMode === 'output' && !collapsed;
  const liveOutRef = useRef<HTMLDivElement>(null);
  const livePinnedRef = useRef(true);
  useEffect(() => {
    if (!pinnedLive) return;
    const el = liveOutRef.current;
    if (el && livePinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [coloredOutput, pinnedLive]);
  const handleLiveScroll = useCallback(() => {
    const el = liveOutRef.current;
    if (el) livePinnedRef.current = isPinnedToBottom(el);
  }, []);

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
  const isRemote = block.isRemote || !!sessionRemote;
  // The session header replaces the prompt line only while the session lives;
  // once finished the card reverts to normal prompt chrome in history.
  const sessionLive = !!(active && sessionKind);
  const modeColor = (sessionLive && sessionKind === 'agent') || isRemote
    ? 'var(--color-agent)'
    : 'var(--color-shell)';

  // Warp-style exit affordance: failures get a red tag, interrupts/signals a
  // neutral one, success stays clean. Never shown while still running.
  const exitClass = active ? 'unknown' : classifyExit(block.exitCode, block.signal);
  const exitLabel =
    exitClass === 'failure' ? `exit ${block.exitCode}`
    : exitClass === 'neutral'
      ? (block.signal ? block.signal : block.exitCode === 130 ? '^C' : `exit ${block.exitCode}`)
      : null;
  const exitTag = exitLabel ? (
    <span className={`${styles.exitTag}${exitClass === 'failure' ? ` ${styles.exitFailure}` : ''}`}>
      {exitLabel}
    </span>
  ) : null;

  // Warp's block action set, on right-click. Portaled to document.body:
  // the card wrapper has content-visibility containment, which would turn
  // it into the containing block for position:fixed and offset the menu
  // away from the cursor. Click handling stops propagation so the card's
  // own onClick (focus/collapse) never fires from menu interactions.
  const contextMenu = menuPos ? createPortal(
    <div
      ref={menuRef}
      className={styles.contextMenu}
      style={{ left: menuPos.x, top: menuPos.y }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <button className={styles.contextItem} onClick={() => { onCopy(block.command); setMenuPos(null); }}>Copy command</button>
      <button className={styles.contextItem} onClick={() => { onCopy(block.output); setMenuPos(null); }}>Copy output</button>
      <button className={styles.contextItem} onClick={() => { onCopy(`${block.command}\n${block.output}`); setMenuPos(null); }}>Copy command + output</button>
      <div className={styles.contextSep} />
      <button className={styles.contextItem} onClick={() => { onRerun(block.command); setMenuPos(null); }}>Re-run command</button>
      <button className={styles.contextItem} onClick={() => { onAskAI(block); setMenuPos(null); }}>Ask AI about this</button>
    </div>,
    document.body,
  ) : null;

  if (collapsed) {
    return (
      <div className={styles.collapsed} onClick={() => onToggleCollapse?.()} onContextMenu={openMenu}>
        <span className={styles.promptUser} style={{ color: modeColor }}>{user}</span>
        {path && <span className={styles.promptPath}>{path}</span>}
        <span className={styles.promptSep}>$</span>
        <span className={styles.cmdDim}>{block.command}</span>
        {exitTag}
        <span className={styles.meta}>{formatDuration(block.duration)}</span>
        {block.summaryLine && <span className={styles.summaryLine}>{block.summaryLine}</span>}
        {contextMenu}
      </div>
    );
  }

  // Active REPL-style cards (running command with stdin available) grow to
  // a near-full-viewport so the user has a real workspace, not a sliver glued
  // to the prompt. Interactive (alt-screen) cards have their own min-height
  // from .interactiveBody; for those we don't need to grow the outer card.
  const replActive =
    isActive && ptyId !== undefined && bodyMode === 'output' && !awaitingInput;

  return (
    <div
      className={styles.block}
      data-card-surface
      style={{
        '--accent-color': modeColor,
        ...(replActive ? REPL_ACTIVE_STYLE : {}),
        ...(pinnedLive ? PINNED_LIVE_STYLE : {}),
      } as React.CSSProperties}
      onClick={() => { if (active && awaitingInput && onSendInput) interactiveRef.current?.focus(); }}
      onContextMenu={openMenu}
    >
      {sessionLive ? (
        <div className={styles.sessionHead}>
          <span className={styles.sessionDot} style={{ background: modeColor, boxShadow: `0 0 7px ${modeColor}` }} />
          <span className={styles.sessionName}>{block.command}</span>
          <span className={styles.kindChip}>
            {sessionKind === 'agent' ? 'agent session' : sessionKind === 'oneshot' ? 'session' : sessionKind}
          </span>
          {port != null && (
            <span
              className={styles.portChip}
              title={`Open http://localhost:${port}`}
              onClick={() => window.tai?.shell?.openExternal(`http://localhost:${port}`)}
            >
              localhost:{port} ↗
            </span>
          )}
          {block.gitBranch && (
            <span className={styles.branchChip}><GitBranch size={10} />{block.gitBranch}</span>
          )}
          <ElapsedChip startTime={block.startTime} />
          <span className={styles.sessionGrow} />
          {headerExtra}
          {sessionKind !== 'agent' && onRestart && (
            <button type="button" className={styles.sessionBtn} onClick={onRestart}>RESTART</button>
          )}
          {onStop && (
            <button type="button" className={`${styles.sessionBtn} ${styles.sessionBtnStop}`} onClick={onStop}>
              {sessionKind === 'agent' ? 'END' : 'STOP'}
            </button>
          )}
        </div>
      ) : (
      <div className={styles.promptLine} onClick={() => onToggleCollapse?.()}>
        <div className={styles.promptLeft}>
          <span className={styles.promptUser} style={{ color: modeColor }}>{user}</span>
          {path && <span className={styles.promptPath} title={block.cwd}>{path}</span>}
          <span className={styles.promptSep}>$</span>
          <span className={styles.cmd}>{block.command}</span>
          {aiSuggested && <span className={styles.viaAi}>ai</span>}
          {!active && block.gitBranch && (
            <span className={styles.branchChip} title={block.cwd}>
              <GitBranch size={10} />
              {block.gitBranch}
            </span>
          )}
        </div>
        <div className={styles.promptRight}>
          {headerExtra}
          {active ? (
            <>
              {awaitingInput ? (
                <span className={styles.awaiting}>
                  <span className={styles.awaitingDot} />
                  INPUT
                </span>
              ) : (
                <span className={styles.running} />
              )}
              {isActive && ptyId !== undefined && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); window.tai?.pty?.write?.(ptyId, '\x03'); }}
                  title="Send Ctrl-C to running command"
                  style={STOP_BTN_STYLE}
                >
                  STOP
                </button>
              )}
            </>
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
              {exitTag}
              <span className={styles.meta}>{formatDuration(block.duration)}</span>
            </>
          )}
        </div>
      </div>
      )}

      {bodyMode === 'password' && ptyId !== undefined && (
        <>
          <div className={styles.separator} style={isRemote ? SEPARATOR_STYLE_REMOTE : SEPARATOR_STYLE_LOCAL} />
          <PasswordPrompt ptyId={ptyId} onDone={onPasswordDone ?? (() => {})} />
        </>
      )}

      {bodyMode === 'interactive' && (
        <>
          <div className={styles.separator} style={isRemote ? SEPARATOR_STYLE_REMOTE : SEPARATOR_STYLE_LOCAL} />
          {isActive ? (
            <div
              ref={onInteractiveContainerRef}
              className={`${styles.interactiveBody}${docked ? ` ${styles.dockedInteractiveBody}` : ''}`}
            />
          ) : (
            <div className={styles.interactiveBody} style={{ minHeight: 80, padding: '10px 16px', opacity: 0.6, fontStyle: 'italic', fontSize: 12 }}>
              (interactive program running…)
            </div>
          )}
        </>
      )}

      {bodyMode === 'output' && block.output && (
        <>
          <div className={styles.separator} style={isRemote ? SEPARATOR_STYLE_REMOTE : SEPARATOR_STYLE_LOCAL} />
          <div className={`${styles.outputArea}${pinnedLive ? ` ${styles.liveOutputArea}` : ''}`}>
            <div
              ref={pinnedLive ? liveOutRef : undefined}
              onScroll={pinnedLive ? handleLiveScroll : undefined}
              className={`${styles.output}${pinnedLive ? ` ${styles.liveOutput}` : ''}`}
              style={isClamped ? { maxHeight: '300px', overflowY: 'hidden' } : undefined}
              dangerouslySetInnerHTML={{ __html: coloredOutput }}
              onClick={handleOutputClick}
            />
            {isLong && !active && (
              <div className={styles.showMore} onClick={() => setShowAll(v => !v)}>
                {showAll ? 'less' : `${outputLineCount} lines`}
              </div>
            )}
          </div>
        </>
      )}

      {bodyMode === 'output' && isActive && ptyId !== undefined && !awaitingInput && (
        <>
          {/* Spacer pushes the input to the bottom of a tall in-list card so
              REPL sessions feel like a dedicated workspace. Pinned live cards
              must NOT have it: the output area is flex:1 there, and a second
              flex:1 sibling would steal half the card's height. */}
          {!pinnedLive && <div className={styles.activeOutputSpacer} />}
          <CardInput ptyId={ptyId} autoFocus={sessionLive} />
        </>
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
      {contextMenu}
    </div>
  );
});

function CardInput({ ptyId, autoFocus }: { ptyId: number; autoFocus?: boolean }) {
  const [value, setValue] = useState('');
  return (
    <input
      autoFocus={autoFocus}
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
