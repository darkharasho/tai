import * as pty from 'node-pty';
import { app, BrowserWindow, ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFile, spawn } from 'child_process';
import { isWindows } from './platform';

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

const allTerminals = new Map<number, pty.IPty>();
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
      spawnArgs = useScope
        ? ['--user', '--scope', '--quiet', '--', shell, '--login']
        : ['--login'];
      termName = 'xterm-256color';
    }

    const term = pty.spawn(spawnCmd, spawnArgs, {
      name: termName,
      cwd: cwd || os.homedir(),
      env,
    });

    allTerminals.set(id, term);

    term.onExit(() => { allTerminals.delete(id); });

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

    const shellPath = process.env.SHELL || '/bin/bash';
    const shellName = isWindows ? null : detectShellName(shellPath);
    const script = shellName ? integrationScriptFor(shellName) : null;

    term.onData((data) => {
      lastDataAt = Date.now();
      safeSend('pty:data', id, data);
    });

    console.log('[tai] integration:', { shellPath, shellName, found: !!script });

    if (!isWindows && script) {
      const quoted = quoteForShell(script);
      const cmd = shellName === 'fish'
        ? `source ${quoted}\n`
        : `. ${quoted}\n`;
      const startedAt = Date.now();
      const tryInject = () => {
        if (integrationInjected) return;
        if (!allTerminals.has(id)) return;
        const idle = Date.now() - lastDataAt;
        const elapsed = Date.now() - startedAt;
        if (idle >= 200 || elapsed >= 5000) {
          integrationInjected = true;
          try {
            term.write(cmd);
            console.log(`[tai] integration: injected (idle=${idle}ms, elapsed=${elapsed}ms)`);
          } catch (e) {
            console.warn('[tai] integration: write failed', e);
          }
          return;
        }
        setTimeout(tryInject, 100);
      };
      setTimeout(tryInject, 250);
    }

    return id;
  });

  ipcMain.on('pty:write', (_event, id: number, data: string) => {
    allTerminals.get(id)?.write(data);
  });

  ipcMain.on('pty:resize', (_event, id: number, cols: number, rows: number) => {
    allTerminals.get(id)?.resize(cols, rows);
  });

  ipcMain.on('pty:kill', (_event, id: number) => {
    const term = allTerminals.get(id);
    if (term) {
      term.kill();
      allTerminals.delete(id);
    }
  });

  ipcMain.handle('pty:getProcess', (_event, id: number) => {
    const term = allTerminals.get(id);
    if (!term) return null;
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
    const term = allTerminals.get(id);
    if (!term) return null;
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
    const term = allTerminals.get(id);
    if (!term || process.platform !== 'linux') return false;
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
    for (const histFile of candidates) {
      try {
        const content = fs.readFileSync(histFile, 'utf8');
        const lines = content.split('\n').filter(Boolean);
        const parsed = lines.map(l => {
          const m = l.match(/^: \d+:\d+;(.*)$/);
          return m ? m[1] : l;
        });
        return parsed.slice(-count);
      } catch { continue; }
    }
    return [];
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
        const lines = stdout.split('\n').filter(Boolean);
        const parsed = lines.map(l => {
          const m = l.match(/^: \d+:\d+;(.*)$/);
          return m ? m[1] : l;
        });
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
  for (const term of allTerminals.values()) term.kill();
  allTerminals.clear();
}
