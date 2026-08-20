import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Runs an interactive shell under a real terminal and returns everything it
 * wrote. The integration scripts only emit their OSC sequences from a genuine
 * PTY, so there is no way around allocating one.
 *
 * Two mechanisms, because neither covers both platforms:
 *
 *  - node-pty, the app's own dependency. Loads from an ABI-independent prebuild
 *    on macOS and Windows. On Linux there is no prebuild, so it is compiled at
 *    install and then rebuilt against Electron's ABI by our postinstall — which
 *    plain Node (vitest) cannot load.
 *  - `script(1)`, which has two incompatible flavours: util-linux takes
 *    `-q -c CMD FILE`, BSD takes `-q FILE CMD...`, and BSD additionally needs a
 *    TTY on its *own* stdin, which no test runner provides. So it is usable on
 *    Linux and useless on macOS.
 *
 * Together they cover every host we run on. Returns null when neither works, so
 * the caller can skip rather than assert against an empty transcript — which is
 * how this used to fail: `script` exits 0 on a usage error, leaving no file, and
 * the ENOENT surfaced from the reader several lines away from the cause.
 */
export async function runInPty(
  file: string,
  args: string[],
  input: string,
  opts: { cwd?: string; settleMs?: number; timeoutMs?: number } = {},
): Promise<string | null> {
  const viaPty = await runViaNodePty(file, args, input, opts);
  if (viaPty !== null) return viaPty;

  const viaScript = runViaScript(file, args, input, opts);
  if (viaScript !== null) return viaScript;

  // Loud on purpose: a silent skip here is a coverage hole that looks green.
  console.warn(
    `[integration] no PTY mechanism available (node-pty unloadable, script(1) ` +
    `unusable on ${process.platform}) — skipping`,
  );
  return null;
}

async function runViaNodePty(
  file: string,
  args: string[],
  input: string,
  opts: { cwd?: string; settleMs?: number; timeoutMs?: number },
): Promise<string | null> {
  let spawn: typeof import('node-pty').spawn;
  try {
    ({ spawn } = await import('node-pty'));
  } catch {
    // Built for Electron's ABI, or not built at all.
    return null;
  }

  const term = spawn(file, args, {
    name: 'xterm-256color',
    cols: 120,
    rows: 40,
    cwd: opts.cwd ?? process.cwd(),
    // TERM=dumb makes the integration scripts bail by design, and runners
    // (including Claude Code) often set it.
    env: { ...process.env, TERM: 'xterm-256color' } as Record<string, string>,
  });

  let out = '';
  term.onData((d) => { out += d; });
  const exited = new Promise<void>((resolve) => { term.onExit(() => resolve()); });

  // A line at a time: an interactive shell reads stdin through its line editor,
  // and pasting the whole block at once drops lines on some configurations.
  for (const line of input.split('\n')) {
    if (!line) continue;
    term.write(`${line}\n`);
    await delay(120);
  }

  await Promise.race([exited, delay(opts.timeoutMs ?? 10_000)]);
  await delay(opts.settleMs ?? 600);
  try { term.kill(); } catch { /* already gone */ }
  return out;
}

function runViaScript(
  file: string,
  args: string[],
  input: string,
  opts: { cwd?: string; timeoutMs?: number },
): string | null {
  if (spawnSync('which', ['script'], { encoding: 'utf8' }).status !== 0) return null;
  if (!isUtilLinuxScript()) return null; // BSD needs a TTY on stdin; runners have none.

  const dir = mkdtempSync(join(tmpdir(), 'tai-pty-'));
  const cmdsPath = join(dir, 'cmds');
  const outPath = join(dir, 'out');
  writeFileSync(cmdsPath, input.endsWith('\n') ? input : `${input}\n`);
  try {
    const command = `${file} ${args.join(' ')} < ${cmdsPath}`;
    spawnSync('script', ['-q', '-c', command, outPath], {
      encoding: 'utf8',
      cwd: opts.cwd,
      timeout: opts.timeoutMs ?? 10_000,
      env: { ...process.env, TERM: 'xterm-256color' },
    });
    return existsSync(outPath) ? readFileSync(outPath, 'utf8') : null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function isUtilLinuxScript(): boolean {
  const probe = spawnSync('script', ['--version'], { encoding: 'utf8' });
  const text = `${probe.stdout ?? ''}${probe.stderr ?? ''}`;
  if (text.includes('util-linux')) return true;
  if (/illegal option|usage: script/i.test(text)) return false;
  return process.platform === 'linux';
}

/**
 * A bash new enough to run the integration, or null.
 *
 * tai-bash.sh emits OSC 133 C and the OSC 6973 preexec hook from `PS0`, which
 * bash gained in 4.4 — deliberately, because the DEBUG trap it replaced gets
 * clobbered by other integrations. macOS still ships bash 3.2, where the script
 * loads and emits prompt markers but never a preexec, so an integration test
 * against /bin/bash there asserts something the shell cannot do.
 */
export function findModernBash(): string | null {
  const candidates = ['bash', '/opt/homebrew/bin/bash', '/usr/local/bin/bash', '/usr/bin/bash'];
  for (const cand of candidates) {
    const probe = spawnSync(cand, ['-c', 'echo ${BASH_VERSINFO[0]}.${BASH_VERSINFO[1]}'], {
      encoding: 'utf8',
    });
    if (probe.status !== 0) continue;
    const [major, minor] = probe.stdout.trim().split('.').map(Number);
    if (Number.isFinite(major) && (major > 4 || (major === 4 && minor >= 4))) return cand;
  }
  return null;
}

/** Every OSC 6973 hex payload in a transcript, in order. */
export function osc6973Payloads(transcript: string): string[] {
  const re = /\x1b\]6973;([0-9a-f]+)\x07/g;
  const found: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(transcript)) !== null) found.push(m[1]);
  return found;
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
