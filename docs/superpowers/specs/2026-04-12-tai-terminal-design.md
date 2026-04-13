# tai — Terminal-First AI Experience

A standalone Electron terminal application that weaves AI directly into the terminal experience. Full-screen terminal that IS the app — AI responses, agent actions, and approvals render as rich blocks injected into native terminal output. The window breathes with a flowing gradient border that shifts color based on context.

## Architecture

Four layers:

### Electron Main Process

Owns system resources. Responsibilities:

- **PTY Service** — spawns shell sessions via node-pty. Ported from sai with Linux-specific enhancements: `/proc/<pid>/stat` for foreground process group tracking, `wchan` for input-awaiting detection, `systemd-run --user --scope` for proper cgroup isolation of GUI apps launched from the terminal. Clears `GIO_LAUNCHED_DESKTOP_FILE`, `CHROME_DESKTOP`, `XDG_ACTIVATION_TOKEN` to prevent DE window-grouping issues.
- **Provider Manager** — manages AI provider subprocesses. Ships with Claude provider that spawns `claude -p --input-format stream-json --output-format stream-json`, reuses sessions with `--resume`. Provider interface designed for future backends (OpenAI, Gemini).
- **Shell Utilities** — shell history reader (parses `~/.zsh_history` / `~/.bash_history`), tab completion via `bash -c compgen`.
- **Config Watcher** — monitors `~/.config/tai/settings.json` for changes, hot-reloads.

### Preload / IPC Bridge

`contextBridge.exposeInMainWorld('tai', ...)` with a domain-grouped typed API:

- `tai.pty.create(cwd)`, `tai.pty.write(id, data)`, `tai.pty.resize(id, cols, rows)`, `tai.pty.kill(id)`, `tai.pty.getProcess(id)`, `tai.pty.getCwd(id)`, `tai.pty.isAwaitingInput(id)`, `tai.pty.tabComplete(id, partial)`, `tai.pty.getShellHistory()`
- `tai.ai.send(providerId, message, context)`, `tai.ai.cancel(providerId)`, `tai.ai.setTrustLevel(level)`, `tai.ai.getCapabilities(providerId)`
- `tai.config.get()`, `tai.config.set(key, value)`, `tai.config.onChanged(callback)`
- `tai.window.minimize()`, `tai.window.maximize()`, `tai.window.close()`

### Renderer (React 19 + Vite + TypeScript)

The UI layer implementing the hybrid rendering model:

- **XtermPane** — primary view. Real xterm.js terminal connected to the PTY. All shell input flows through xterm natively. Handles resize via `@xterm/addon-fit` with `ResizeObserver` + `IntersectionObserver`. Clickable URLs via `@xterm/addon-web-links`.
- **BlockOverlay** — React layer rendering rich blocks (AI responses, agent cards, approval prompts) injected between xterm output regions. The BlockSegmenter marks insertion points when commands finish.
- **ModeDetector** — auto-detect heuristic engine (ported from sai's `looksLikeShellCommand()`) determining shell vs AI intent. Analyzes known command set, NL starters, pronoun detection, shell-quote parsing.
- **TabBar** — tab management for multiple terminal sessions.
- **GradientBorder** — full-window flowing gradient that shifts with context.
- **SettingsOverlay** — settings panel triggered by `Ctrl+,`.

### Provider Layer

Abstraction for AI backends:

```typescript
interface Provider {
  id: string;
  name: string;
  send(message: string, context: TerminalContext, options: SendOptions): AsyncIterable<StreamChunk>;
  cancel(): void;
  getCapabilities(): ProviderCapabilities;
}

interface ProviderCapabilities {
  streaming: boolean;
  toolUse: boolean;
  fileEdit: boolean;
  commandExecution: boolean;
}
```

Ships with `ClaudeCliProvider` that manages a persistent `claude -p` subprocess with streaming JSON protocol. Adding a new provider means implementing this interface — no UI changes required.

## Visual Design

### Color System

Dark base (#0a0a12) with neon context colors:

| Context | Color | Hex | Usage |
|---------|-------|-----|-------|
| Shell | Green | #00ff88 | Prompt, success states, shell mode indicator |
| AI | Purple | #a855f7 | AI responses, AI mode indicator, query accent |
| Agent | Orange | #fb923c | Agent steps, execution progress, agent mode |
| Error | Red | #ef4444 | Error highlighting, failed states |
| Warning | Yellow | #facc15 | Warnings, caution states |
| Info | Blue | #38bdf8 | Informational messages |

### Gradient Border

A flowing gradient wraps the entire application window. Implementation uses the mask-based gradient border technique:

- A `::before` pseudo-element on the window frame with `background-size: 300% 300%`
- `background-position` animates via `gradient-sweep` keyframes over 20 seconds, `ease-in-out`, `infinite`, `alternate`
- CSS `mask` with `mask-composite: exclude` punches out the interior, leaving only the border ring
- A blurred glow layer behind adds a soft ambient halo
- Gradient colors transition over 1.5s when context changes (shell → AI → agent → error)
- Opacity: 0.7 at rest, 1.0 on focus

### Typography

Font stack: Geist Mono → JetBrains Mono NF → Fira Code → monospace. Single font family throughout — terminal and UI use the same face.

### Icons

Lucide React for all iconography.

## Hybrid Rendering Model

The central architectural decision. xterm.js is the primary renderer for shell interaction. Rich UI blocks are injected into the terminal flow for AI content.

### XtermPane

- Real xterm.js instance connected to a PTY via node-pty
- All shell input is native — cursor, selection, keyboard shortcuts, history navigation, tab completion handled by the shell through the PTY
- Standard terminal features: scrollback buffer, copy/paste, clickable links, resize

### BlockOverlay

- React component layer positioned over xterm
- BlockSegmenter (ported from sai, adapted) monitors the PTY byte stream and detects:
  - Shell prompt patterns via regex to identify command boundaries
  - Alt-screen mode transitions via ANSI escape sequences
  - Remote SSH sessions by comparing user@host identity
- When a command completes or AI responds, a rich block is rendered below the corresponding xterm output. The overlay tracks xterm's viewport and scroll offset — each block is anchored to a specific row in the xterm buffer (the row where the command's output ended). As xterm scrolls, blocks scroll with it. The overlay container uses `position: absolute` with `top` values derived from xterm's row height × anchor row.
- Blocks are visually distinct from terminal output but part of the same scroll flow

### Block Types

**AI Response Block:**
- Purple left-border accent, subtle background tint (`rgba(168,85,247, 0.06)`)
- Streaming markdown rendering (ReactMarkdown + remark-gfm)
- Code blocks with Shiki syntax highlighting
- Action buttons (Lucide icons): Run (sends to PTY), Copy, Apply (for file diffs)
- Collapsible to one-line summary

**Agent Step Card:**
- Orange accent
- Execution plan rendered as a checklist: pending (○), running (spinner), complete (✓), failed (✗)
- Live output inline for the running step
- Collapsible once task completes

**Approval Prompt:**
- Appears inline when trust level requires approval
- Shows proposed command/action with syntax highlighting
- Buttons: Approve, Edit (modify before running), Reject
- Keybinds: `Enter` approve, `e` edit, `Esc` reject

**Error Affordance:**
- Appears after non-zero exit codes or common error patterns
- Subtle "Ask AI to fix?" prompt with one-click or keybind to send error context to AI

### Block Behavior

- New blocks don't yank scroll position — respect what the user is reading
- Keyboard navigation: `Ctrl+Up/Down` to jump between blocks
- Fade-in animation on appearance
- All blocks collapsible

## Input System

### Shell Mode (Default)

User types directly into xterm. Native terminal input — no reimplementation.

The ModeDetector runs passively, analyzing the current input buffer each keystroke. Uses sai's heuristic engine: known command set, NL starters ("how do I", "what is", "why does"), pronoun detection, shell-quote parsing.

A mode indicator near the prompt shows green `$` for shell. Flashes to purple `✦` momentarily when the heuristic detects AI-like input. Non-intrusive.

**Ghost text predictions:** inline history-based suggestions scored by frequency + recency (ported from sai). Tab to accept, keep typing to ignore.

### Switching to AI Mode

- **Auto-trigger**: when ModeDetector is confident it's natural language (high threshold), a subtle prompt: "Press Enter to ask AI, Esc to run as shell."
- **Manual toggle**: `Shift+Tab` or `Ctrl+K` opens the AI input panel — a text area that slides in above the terminal. Supports multi-line input and context references (@file, @terminal).
- **Prefix shortcut**: typing `?` as the first character immediately opens AI mode.

### Back to Shell

Esc dismisses the AI panel, focus returns to xterm. Starting to type a command auto-detects back to shell mode.

## Trust Levels

Three configurable tiers controlling AI autonomy:

| Level | Behavior | Description |
|-------|----------|-------------|
| **Ask** (default) | Every AI-initiated action needs approval | Safest — approval prompt for all commands and edits |
| **Approve Edits** | Read-only commands run freely, modifications need approval | Balanced — AI can `ls`, `cat`, `grep` without asking |
| **Bypass** | AI executes autonomously, no approval gates | Full agent mode — AI acts without interruption |

- Cycle with command `tai trust` or via Settings overlay. Trust level is not a high-frequency toggle — it's set once per session or directory, so a keybind is unnecessary. `Shift+Tab` is reserved exclusively for AI mode toggle.
- Configurable in settings: default level for new sessions, per-directory overrides
- Trust level displayed in a small badge in the tab bar or status area
- Per-session by default, persistable per-directory in config

## Tab Management

Tab bar at the top of the window, below the title bar.

### Tab Display

- Each tab shows: index number, process name (zsh, node, python), working directory basename
- Active tab has a subtle underline in the current context color
- Process name updates in real-time via PTY process tracking

### Keybindings

| Action | Keybind |
|--------|---------|
| New tab | `Ctrl+Shift+T` or click `+` |
| Close tab | `Ctrl+Shift+W` (confirms if process running) |
| Switch to tab N | `Ctrl+1` through `Ctrl+9` |
| Next tab | `Ctrl+Tab` |
| Previous tab | `Ctrl+Shift+Tab` |
| Rename tab | Double-click label |
| Reorder | Drag and drop |

### Tab Architecture

Each tab is a self-contained `TerminalSession`:

```typescript
interface TerminalSession {
  id: string;
  ptyId: number;
  xterm: Terminal;
  blockState: BlockState;
  aiConversation: ConversationHistory;
  trustLevel: TrustLevel;
  scrollPosition: number;
}
```

Designed so splits can be added later — rendering two sessions side by side requires no fundamental rework.

## Alt-Screen App Support

Full-screen terminal applications (vim, htop, less, nano) get unobstructed access.

**Detection:** ported from sai's BlockSegmenter — watches for ANSI escape sequences `\x1b[?1049h` (enter alt-screen) and `\x1b[?1049l` (exit alt-screen).

**On alt-screen enter:**
- BlockOverlay hides completely — xterm takes 100% of the view
- Gradient border stays (ambient, not intrusive)
- Tab bar stays
- ModeDetector pauses — all input goes to PTY
- No ghost text, no mode indicators

**On alt-screen exit:**
- BlockOverlay restores, previous blocks reappear in scroll history
- ModeDetector resumes
- BlockSegmenter re-syncs with the prompt pattern

## Settings & Configuration

### Access

`Ctrl+,` opens a settings overlay (not a separate window). Esc to dismiss.

### Categories

- **General** — default shell, starting directory, font family/size, cursor style (block/beam/underline)
- **AI Provider** — provider selection, API key / CLI path, model selection, effort level. UI renders fields from the active provider's config schema.
- **Trust** — default trust level, per-directory overrides
- **Appearance** — gradient border on/off, animation speed, opacity
- **Keybindings** — rebindable shortcuts, searchable list, conflict detection

### Storage

JSON at `~/.config/tai/settings.json`. Watched for external changes (hot reload). Sensible defaults — zero config to start.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Shell | Electron 36 |
| Frontend | React 19 + TypeScript + Vite |
| Terminal | @xterm/xterm + @xterm/addon-fit + @xterm/addon-web-links |
| PTY | node-pty |
| AI (v1) | Claude CLI subprocess (streaming JSON) |
| Icons | Lucide React |
| Markdown | ReactMarkdown + remark-gfm |
| Syntax Highlighting | Shiki |
| Config | JSON (~/.config/tai/settings.json) |
| Fonts | Geist Mono / JetBrains Mono NF / Fira Code |

## Ported from sai (Adapted)

These modules are largely standalone and proven — ported and adapted for tai's hybrid architecture:

- PTY service (`electron/services/pty.ts`) — node-pty management, Linux process tracking, systemd scoping
- BlockSegmenter — adapted to mark insertion points for the overlay model rather than driving a full block renderer
- Command detection heuristics (`looksLikeShellCommand()`) — known commands, NL detection, shell-quote parsing
- Shell history reader + ghost text frequency/recency scoring
- Tab completion via compgen
- Alt-screen detection (ANSI escape watching)
- Linux `/proc` process group tracking and `wchan` input detection

## Built Fresh

These are new to tai, driven by architectural differences from sai:

- Hybrid rendering engine (XtermPane + BlockOverlay)
- Provider abstraction layer with `Provider` interface
- Tab management system with `TerminalSession` isolation
- Settings system with overlay UI and JSON config
- Gradient border system with context-aware color transitions
- Input mode switching UX (xterm-native shell + separate AI panel)
- Trust level system with per-session and per-directory configuration
