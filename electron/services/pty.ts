import * as pty from 'node-pty';
import { app, BrowserWindow, ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFile, spawn } from 'child_process';
import { isWindows } from './platform';
import { createResizeQueue, type ResizeQueue } from './resizeQueue';
import { createCoalescingBuffer, type CoalescingBuffer } from './coalescingBuffer';
import { createBackpressureGate, type BackpressureGate } from './backpressureGate';
import { TermiosPoller, defaultTermiosReader } from './termiosPoller';
import { parseHistoryFile, unmetafyZsh } from './parseShellHistory';
import { credentialVault } from './credentialVault';
import { resolveForeground } from './foregroundProcess';
import { decideAutoFill } from './sudoAutoFill';

const BACKPRESSURE_HIGH = 512 * 1024;
const BACKPRESSURE_LOW = 128 * 1024;

// Resolves the on-disk directory holding the OSC 133 shell integration
// scripts. In dev they live under the source tree; in packaged builds they're
// copied to resources/ via electron-builder's extraResources.
let _cachedShellIntegrationDir: string | null | undefined;
function shellIntegrationDir(): string | null {
  if (_cachedShellIntegrationDir !== undefined) return _cachedShellIntegrationDir;
  const candidates = [
    path.join(process.resourcesPath || '', 'shell-integration'),
    path.join(__dirname, '..', 'electron', 'shell-integration'),
    path.join(app.getAppPath(), 'electron', 'shell-integration'),
  ];
  _cachedShellIntegrationDir = candidates.find(c => c && fs.existsSync(c)) ?? null;
  return _cachedShellIntegrationDir;
}

function detectShellName(shellPath: string): 'bash' | 'zsh' | 'fish' | null {
  const base = path.basename(shellPath).toLowerCase();
  if (base.includes('bash')) return 'bash';
  if (base.includes('zsh')) return 'zsh';
  if (base.includes('fish')) return 'fish';
  return null;
}

function integrationScriptFor(shellName: 'bash' | 'zsh' | 'fish'): string | null {
  const dir = shellIntegrationDir();
  if (!dir) return null;
  const file = shellName === 'bash' ? 'tai-bash.sh'
    : shellName === 'zsh' ? 'tai-zsh.zsh'
    : 'tai-fish.fish';
  const full = path.join(dir, file);
  return fs.existsSync(full) ? full : null;
}

function quoteForShell(p: string): string {
  return `'${p.replace(/'/g, `'\\''`)}'`;
}

/**
 * Build the shell command TAI injects to source its integration script.
 *
 * A leading space is prepended so that:
 *  - bash/zsh with HISTCONTROL=ignorespace or HISTORY_IGNORE skip it
 *  - fish ignores leading-space commands by default
 *  - the bash self-scrub in tai-bash.sh can also delete it reactively
 *
 * Exported for unit-testing.
 */
export function buildZshShimEnv(
  baseEnv: Record<string, string>,
  opts: { shimDir: string; integrationPath: string; home: string },
): Record<string, string> {
  const userZdotdir = baseEnv.ZDOTDIR || opts.home;
  return {
    ...baseEnv,
    ZDOTDIR: opts.shimDir,
    TAI_ZSH_SHIM: opts.shimDir,
    TAI_ZSH_INTEGRATION: opts.integrationPath,
    TAI_ZDOTDIR_USER: userZdotdir,
    TAI_ZDOTDIR_WAS_SET: baseEnv.ZDOTDIR ? '1' : '',
  };
}

/**
 * Converts a zsh-shim env object into systemd-run `--setenv=KEY=VALUE` args.
 * These are inserted before the `--` separator in the systemd-run argv so that
 * the zsh shim variables are explicitly forwarded even if scope env inheritance
 * behaves unexpectedly. Exported for unit-testing.
 */
export function zshShimSetenvArgs(shimEnv: Record<string, string>): string[] {
  const keys = ['ZDOTDIR', 'TAI_ZSH_SHIM', 'TAI_ZSH_INTEGRATION', 'TAI_ZDOTDIR_USER', 'TAI_ZDOTDIR_WAS_SET'] as const;
  return keys.map((k) => `--setenv=${k}=${shimEnv[k] ?? ''}`);
}

export function buildIntegrationSourceCommand(shellName: string, quotedPath: string): string {
  if (shellName === 'fish') {
    return ` source ${quotedPath}\n`;
  }
  return ` . ${quotedPath}\n`;
}

let hasSystemdRun: boolean | undefined;
function detectSystemdScope(): boolean {
  if (process.platform !== 'linux') return false;
  if (hasSystemdRun !== undefined) return hasSystemdRun;
  try {
    const { execFileSync } = require('child_process') as typeof import('child_process');
    execFileSync('systemd-run', ['--user', '--scope', '--', '/bin/true'], {
      stdio: 'ignore', timeout: 3000,
    });
    hasSystemdRun = true;
  } catch {
    hasSystemdRun = false;
  }
  return hasSystemdRun;
}

let canUseSystemdScope = detectSystemdScope;

interface TerminalEntry {
  term: pty.IPty;
  resizeQueue: ResizeQueue;
  buffer: CoalescingBuffer;
  gate: BackpressureGate;
  poller: TermiosPoller | null;
}
const allTerminals = new Map<number, TerminalEntry>();
// Tracks the last time we auto-filled a sudo prompt per PTY, so a fast
// re-prompt (sudo rejecting the cached secret) can invalidate the cache.
const lastAutoFillAt = new Map<number, number>();
let nextId = 1;

export function setupPtyService(getWindow: () => BrowserWindow | null) {
  function safeSend(channel: string, ...args: unknown[]) {
    const win = getWindow();
    try {
      if (win && !win.isDestroyed()) {
        win.webContents.send(channel, ...args);
      }
    } catch {}
  }

  ipcMain.handle('pty:create', (_event, cwd: string) => {
    const id = nextId++;
    const env = { ...process.env } as Record<string, string>;
    delete env.GIO_LAUNCHED_DESKTOP_FILE;
    delete env.GIO_LAUNCHED_DESKTOP_FILE_PID;
    delete env.BAMF_DESKTOP_FILE_HINT;
    delete env.XDG_ACTIVATION_TOKEN;
    delete env.DESKTOP_STARTUP_ID;
    delete env.CHROME_DESKTOP;
    delete env.INVOCATION_ID;

    let spawnCmd: string;
    let spawnArgs: string[];
    let termName: string;

    if (isWindows) {
      spawnCmd = process.env.COMSPEC || 'cmd.exe';
      spawnArgs = [];
      termName = 'xterm-256color';
    } else {
      const shell = process.env.SHELL || '/bin/bash';
      const useScope = canUseSystemdScope();
      spawnCmd = useScope ? 'systemd-run' : shell;
      // spawnArgs finalized below after zsh-shim detection (may insert --setenv flags).
      spawnArgs = useScope
        ? ['--user', '--scope', '--quiet', '--', shell, '--login']
        : ['--login'];
      termName = 'xterm-256color';
    }

    // Compute shell name early so we can mutate env before pty.spawn.
    const shellPath = process.env.SHELL || '/bin/bash';
    const shellName = isWindows ? null : detectShellName(shellPath);

    // zsh: load integration via a ZDOTDIR shim at startup (no typed source,
    // no echo, no history). Other shells keep the typed-injection path below.
    let zshShimActive = false;
    if (!isWindows && shellName === 'zsh') {
      const dir = shellIntegrationDir();
      const integ = integrationScriptFor('zsh');
      const shim = dir ? path.join(dir, 'zsh-shim') : null;
      if (shim && integ && fs.existsSync(shim)) {
        const shimEnv = buildZshShimEnv(env, { shimDir: shim, integrationPath: integ, home: os.homedir() });
        Object.assign(env, shimEnv);
        zshShimActive = true;
        // For the systemd-run --scope path, --scope *should* inherit the caller
        // environment, but we insert explicit --setenv args as insurance so the
        // zsh shim variables are guaranteed to reach the child process.
        if (spawnCmd === 'systemd-run') {
          const setenvArgs = zshShimSetenvArgs(shimEnv);
          // Insert before the '--' separator (systemd-run flags must precede '--').
          const sepIdx = spawnArgs.indexOf('--');
          if (sepIdx !== -1) {
            spawnArgs = [
              ...spawnArgs.slice(0, sepIdx),
              ...setenvArgs,
              ...spawnArgs.slice(sepIdx),
            ];
          }
        }
      } else {
        console.warn(
          '[tai] zsh-shim not found, falling back to typed injection:',
          !dir ? 'shell-integration dir unavailable' :
          !integ ? 'integration script not found' :
          !shim ? 'shim path could not be resolved' :
          `shim dir missing at ${shim}`,
        );
      }
    }

    const term = pty.spawn(spawnCmd, spawnArgs, {
      name: termName,
      cwd: cwd || os.homedir(),
      env,
    });

    let buffer: CoalescingBuffer;
    const resizeQueue = createResizeQueue((cols, rows) => {
      buffer?.forceFlush();
      try { term.resize(cols, rows); } catch {}
      safeSend('pty:resized', id, cols, rows);
    });
    const gate = createBackpressureGate({
      high: BACKPRESSURE_HIGH,
      low: BACKPRESSURE_LOW,
      pause: () => { try { term.pause(); } catch {} },
      resume: () => { try { term.resume(); } catch {} },
    });
    buffer = createCoalescingBuffer((chunk) => {
      safeSend('pty:data', id, chunk);
      gate.onSent(chunk.length);
    });
    const masterFd: number | undefined = (term as unknown as { _fd?: number })._fd;
    let poller: TermiosPoller | null = null;
    if (process.platform !== 'win32' && typeof masterFd === 'number') {
      try {
        const reader = defaultTermiosReader();
        poller = new TermiosPoller(masterFd, reader, (e) => {
          if (e.passwordPrompt && process.platform === 'linux') {
            const foreground = resolveForeground(term.pid);
            const last = lastAutoFillAt.get(id) ?? null;
            const decision = decideAutoFill({
              foreground,
              vaultSet: credentialVault.isSet(),
              msSinceLastAutoFill: last === null ? null : Date.now() - last,
            });
            if (decision === 'auto-fill') {
              const secret = credentialVault.get();
              if (secret) {
                try { term.write(secret.toString('utf8') + '\n'); } catch {}
                lastAutoFillAt.set(id, Date.now());
                safeSend('pty:auto-auth', id);
                return; // do NOT surface the widget
              }
            } else if (decision === 'reject') {
              credentialVault.clear();
              lastAutoFillAt.delete(id);
              safeSend('pty:secret-state', false);
              // fall through to surface the widget for a fresh attempt
            }
          }
          safeSend('pty:echo-change', id, {
            echo: e.echo,
            icanon: e.icanon,
            passwordPrompt: e.passwordPrompt,
            interactiveProgram: e.interactiveProgram,
          });
        });
      } catch (err) {
        console.warn('[pty] termios poller unavailable:', err);
      }
    }

    allTerminals.set(id, { term, resizeQueue, buffer, gate, poller });

    term.onExit(() => {
      poller?.stop();
      allTerminals.delete(id);
      lastAutoFillAt.delete(id);
    });

    // Inject shell integration once bash/zsh/fish has finished its rc files
    // and is sitting at an interactive prompt. We can't write at spawn time:
    // the TTY echoes the bytes back but the shell hasn't entered its REPL yet,
    // so the source command is silently discarded.
    //
    // Heuristic: relay all PTY data to the renderer, and track byte arrival
    // times. When the stream goes idle for ~200ms (meaning the prompt has
    // rendered and the shell is waiting for input), write the source line.
    // Bounded by a hard ceiling so we don't wait forever on weirdly chatty rc.
    let integrationInjected = false;
    let lastDataAt = Date.now();

    const script = shellName ? integrationScriptFor(shellName) : null;

    term.onData((data) => {
      lastDataAt = Date.now();
      buffer.push(data);
    });

    if (!isWindows && script && !(shellName === 'zsh' && zshShimActive)) {
      const quoted = quoteForShell(script);
      const cmd = buildIntegrationSourceCommand(shellName!, quoted);
      const startedAt = Date.now();
      // Bash's login startup runs /etc/profile, ~/.bash_profile, etc. before
      // entering its REPL. If we write the source command before the REPL is
      // live the bytes are echoed by the TTY layer but never executed. So we
      // wait for the stream to go quiet for a sustained idle period (≥600ms),
      // bounded by an 8s ceiling so a chatty rc can't pin us forever.
      const tryInject = () => {
        if (integrationInjected) return;
        if (!allTerminals.has(id)) return;
        const idle = Date.now() - lastDataAt;
        const elapsed = Date.now() - startedAt;
        if (idle >= 600 || elapsed >= 8000) {
          integrationInjected = true;
          try { term.write(cmd); } catch (e) {
            console.warn('[tai] shell-integration injection failed', e);
          }
          return;
        }
        setTimeout(tryInject, 150);
      };
      setTimeout(tryInject, 500);
    }

    return id;
  });

  ipcMain.on('pty:write', (_event, id: number, data: string) => {
    allTerminals.get(id)?.term.write(data);
  });

  ipcMain.on('pty:resize', (_event, id: number, cols: number, rows: number) => {
    allTerminals.get(id)?.resizeQueue.enqueue(cols, rows);
  });

  ipcMain.on('pty:data-ack', (_event, id: number, bytes: number) => {
    allTerminals.get(id)?.gate.onAck(bytes);
  });

  ipcMain.on('pty:kill', (_event, id: number) => {
    const entry = allTerminals.get(id);
    if (entry) {
      entry.poller?.stop();
      entry.buffer.forceFlush();
      entry.term.kill();
      allTerminals.delete(id);
    }
  });

  ipcMain.on('pty:start-echo-poll', (_event, id: number) => {
    allTerminals.get(id)?.poller?.start();
  });

  ipcMain.on('pty:stop-echo-poll', (_event, id: number) => {
    allTerminals.get(id)?.poller?.stop();
  });

  ipcMain.on('pty:remember-secret', (_event, secret: string) => {
    if (typeof secret !== 'string' || secret.length === 0) return;
    credentialVault.set(Buffer.from(secret, 'utf8'));
    safeSend('pty:secret-state', true);
  });

  ipcMain.on('pty:forget-secret', () => {
    credentialVault.clear();
    safeSend('pty:secret-state', false);
  });

  ipcMain.handle('pty:getProcess', (_event, id: number) => {
    const entry = allTerminals.get(id);
    if (!entry) return null;
    const term = entry.term;
    if (process.platform === 'linux') {
      try {
        const stat = fs.readFileSync(`/proc/${term.pid}/stat`, 'utf8');
        const closeParenIdx = stat.lastIndexOf(')');
        const fields = stat.slice(closeParenIdx + 2).split(' ');
        const tpgid = parseInt(fields[5], 10);
        if (tpgid > 0) {
          const comm = fs.readFileSync(`/proc/${tpgid}/comm`, 'utf8').trim();
          return comm || term.process;
        }
      } catch {}
    }
    return term.process;
  });

  ipcMain.handle('pty:getCwd', (_event, id: number) => {
    const entry = allTerminals.get(id);
    if (!entry) return null;
    const term = entry.term;
    if (process.platform === 'linux') {
      try {
        return fs.readlinkSync(`/proc/${term.pid}/cwd`);
      } catch {}
    }
    if (process.platform === 'darwin') {
      return new Promise<string | null>((resolve) => {
        execFile('lsof', ['-a', '-d', 'cwd', '-p', String(term.pid), '-Fn'],
          { timeout: 2000 },
          (_err, stdout) => {
            if (!stdout) { resolve(null); return; }
            const nLine = stdout.split('\n').find(l => l.startsWith('n') && l.length > 1);
            resolve(nLine ? nLine.slice(1) : null);
          }
        );
      });
    }
    return null;
  });

  ipcMain.handle('pty:isAwaitingInput', (_event, id: number) => {
    const entry = allTerminals.get(id);
    if (!entry || process.platform !== 'linux') return false;
    const term = entry.term;
    try {
      const stat = fs.readFileSync(`/proc/${term.pid}/stat`, 'utf8');
      const closeParenIdx = stat.lastIndexOf(')');
      const fields = stat.slice(closeParenIdx + 2).split(' ');
      const tpgid = parseInt(fields[5], 10);
      if (tpgid <= 0) return false;
      const wchan = fs.readFileSync(`/proc/${tpgid}/wchan`, 'utf8').trim();
      return wchan === 'n_tty_read' || wchan === 'read_chan' || wchan === 'wait_woken';
    } catch {
      return false;
    }
  });

  ipcMain.handle('pty:tabComplete', async (_event, text: string, cwd: string) => {
    if (isWindows) return [];
    const lastWord = text.split(/\s+/).pop() || '';
    const isFirstWord = !text.includes(' ');
    const flags = isFirstWord ? '-c -f' : '-f -d';
    const escaped = lastWord ? lastWord.replace(/'/g, "'\\''") : '';
    const cmd = escaped
      ? `shopt -s nocaseglob nocasematch; compgen ${flags} -- '${escaped}' 2>/dev/null | head -50`
      : `compgen ${flags} 2>/dev/null | head -50`;
    return new Promise<string[]>((resolve) => {
      execFile('bash', ['-c', cmd], { cwd, timeout: 2000 }, (err, stdout) => {
        if (err || !stdout.trim()) { resolve([]); return; }
        const raw = [...new Set(stdout.trim().split('\n').filter(Boolean))];
        const results = raw.map(entry => {
          const absPath = path.isAbsolute(entry) ? entry : path.resolve(cwd, entry);
          try {
            if (fs.statSync(absPath).isDirectory()) return entry + '/';
          } catch {}
          return entry;
        });
        resolve(results);
      });
    });
  });

  ipcMain.handle('pty:getShellHistory', async (_event, count: number) => {
    const home = os.homedir();
    const candidates = isWindows
      ? [
          path.join(process.env.APPDATA || home, 'Microsoft', 'Windows', 'PowerShell', 'PSReadLine', 'ConsoleHost_history.txt'),
        ]
      : [
          path.join(home, '.zsh_history'),
          path.join(home, '.bash_history'),
        ];
    // Merge every history file that exists (a stale .zsh_history must not
    // shadow the user's live .bash_history), preserving per-file order.
    const merged: string[] = [];
    for (const histFile of candidates) {
      try {
        const content = unmetafyZsh(fs.readFileSync(histFile));
        merged.push(...parseHistoryFile(content).slice(-count));
      } catch { continue; }
    }
    return merged.slice(-count);
  });

  // Shell integration check/install for a remote host. Used by the renderer
  // when an SSH session is detected without OSC 133 markers, so we can offer
  // the user one-click install of the integration over there.
  const SSH_TARGET_RE = /^[\w.-]+(@[\w.-]+)?$/;
  ipcMain.handle('shellIntegration:checkRemote', async (_event, target: string) => {
    if (!SSH_TARGET_RE.test(target)) return { installed: false };
    return new Promise<{ installed: boolean }>((resolve) => {
      const check = 'if [ -f "$HOME/.config/tai/shell-integration.sh" ] || [ -f "$HOME/.config/tai/shell-integration.zsh" ]; then echo OK; fi';
      execFile('ssh', ['-o', 'ConnectTimeout=3', '-o', 'BatchMode=yes', target, check], { timeout: 5000 }, (err, stdout) => {
        resolve({ installed: !err && stdout.trim() === 'OK' });
      });
    });
  });

  ipcMain.handle('shellIntegration:installRemote', async (_event, target: string) => {
    if (!SSH_TARGET_RE.test(target)) {
      return { ok: false, error: 'Invalid SSH target' };
    }
    const dir = shellIntegrationDir();
    if (!dir) return { ok: false, error: 'Local integration scripts not found' };

    let bashScript: string;
    let zshScript: string;
    try {
      bashScript = fs.readFileSync(path.join(dir, 'tai-bash.sh'), 'utf8');
      zshScript = fs.readFileSync(path.join(dir, 'tai-zsh.zsh'), 'utf8');
    } catch (e) {
      return { ok: false, error: `Could not read integration scripts: ${(e as Error).message}` };
    }

    const sshArgs = (cmd: string) => [
      '-o', 'ConnectTimeout=5',
      '-o', 'BatchMode=yes',
      target,
      cmd,
    ];

    const sshWithStdin = (cmd: string, input: string) => new Promise<{ code: number; stderr: string }>((resolve) => {
      const child = spawn('ssh', sshArgs(cmd));
      let stderr = '';
      const timer = setTimeout(() => { child.kill('SIGTERM'); }, 10000);
      child.stderr.on('data', (d) => { stderr += d.toString(); });
      child.on('close', (code) => { clearTimeout(timer); resolve({ code: code ?? -1, stderr: stderr.trim() }); });
      child.stdin.on('error', () => {});
      child.stdin.end(input);
    });

    // 1. mkdir and write the bash integration via stdin.
    const r1 = await sshWithStdin(`mkdir -p "$HOME/.config/tai" && cat > "$HOME/.config/tai/shell-integration.sh" && chmod 644 "$HOME/.config/tai/shell-integration.sh"`, bashScript);
    if (r1.code !== 0) return { ok: false, error: r1.stderr || `ssh exited ${r1.code}` };

    // 2. Write the zsh integration.
    const r2 = await sshWithStdin(`cat > "$HOME/.config/tai/shell-integration.zsh" && chmod 644 "$HOME/.config/tai/shell-integration.zsh"`, zshScript);
    if (r2.code !== 0) return { ok: false, error: r2.stderr || `ssh exited ${r2.code}` };

    // 3. Idempotently append source-lines to ~/.bashrc / ~/.zshrc.
    const rcAppender = `for rc in "$HOME/.bashrc" "$HOME/.zshrc"; do
  [ -e "$rc" ] || continue
  if ! grep -q 'tai shell integration' "$rc"; then
    case "$rc" in
      *.bashrc) f="$HOME/.config/tai/shell-integration.sh" ;;
      *.zshrc)  f="$HOME/.config/tai/shell-integration.zsh" ;;
    esac
    printf '\\n# tai shell integration\\n[ -f %s ] && . %s\\n' "$f" "$f" >> "$rc"
  fi
done`;
    const r3 = await sshWithStdin(rcAppender, '');
    if (r3.code !== 0) return { ok: false, error: r3.stderr || `ssh exited ${r3.code}` };

    return { ok: true };
  });

  ipcMain.handle('pty:getRemoteShellHistory', async (_event, target: string, count: number) => {
    return new Promise<string[]>((resolve) => {
      // Sanitize target to prevent command injection - only allow user@host or host patterns
      if (!/^[\w.-]+(@[\w.-]+)?$/.test(target)) {
        resolve([]);
        return;
      }
      const cmd = 'cat ~/.bash_history ~/.zsh_history 2>/dev/null || true';
      execFile('ssh', ['-o', 'ConnectTimeout=3', '-o', 'BatchMode=yes', target, cmd], { timeout: 5000 }, (err, stdout) => {
        if (err || !stdout) {
          resolve([]);
          return;
        }
        const parsed = parseHistoryFile(stdout);
        // Deduplicate while preserving order (most recent last)
        const seen = new Set<string>();
        const unique = [];
        for (let i = parsed.length - 1; i >= 0; i--) {
          if (!seen.has(parsed[i])) {
            seen.add(parsed[i]);
            unique.unshift(parsed[i]);
          }
        }
        resolve(unique.slice(-count));
      });
    });
  });
}

export function destroyAllTerminals() {
  for (const entry of allTerminals.values()) {
    entry.poller?.stop();
    entry.buffer.forceFlush();
    entry.term.kill();
  }
  allTerminals.clear();
}
