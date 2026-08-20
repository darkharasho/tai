// Pure path logic — deliberately free of node builtins so it stays unit
// testable under the renderer-shimmed vite config. Callers inject `exists`.

const PKG = '@anthropic-ai/claude-agent-sdk';

/**
 * Rewrite a path pointing inside app.asar to its app.asar.unpacked twin.
 *
 * Electron patches `fs` so paths inside app.asar appear to exist, but app.asar
 * is a regular file to the kernel — exec'ing a path through it fails with
 * ENOTDIR. electron-builder's asarUnpack writes the real binary next door in
 * app.asar.unpacked, so swapping the segment yields a spawnable path.
 */
export function unpackedAsarPath(p: string): string {
  return p.replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2');
}

/** Join using whichever separator `base` already uses. */
function joinPath(base: string, ...parts: string[]): string {
  const sep = base.includes('\\') && !base.includes('/') ? '\\' : '/';
  const trimmed = base.endsWith(sep) ? base.slice(0, -sep.length) : base;
  return [trimmed, ...parts].join(sep);
}

/**
 * Whether this Linux host is musl-based (no glibc runtime reported), which
 * decides the preferred binary flavour. Mirrors the SDK's own detection.
 */
export function isMuslLinux(
  platform: string = process.platform,
  // `null` is how a caller says "no report API here". It cannot be `undefined`:
  // passing that explicitly triggers the default, handing the caller the host's
  // real process.report — on macOS that reports no glibc runtime, which reads
  // as musl.
  report: { getReport?: () => unknown } | null = process.report as any,
): boolean {
  if (platform !== 'linux') return false;
  const r = typeof report?.getReport === 'function' ? (report.getReport() as any) : null;
  return r != null && r.header?.glibcVersionRuntime === undefined;
}

/** Package-relative specs for the bundled CLI, best flavour first. */
export function binaryCandidates(platform: string, arch: string, muslFirst: boolean): string[] {
  const exe = platform === 'win32' ? 'claude.exe' : 'claude';
  const dirs =
    platform === 'android'
      ? [`${PKG}-linux-${arch}-android`]
      : platform === 'linux'
        ? muslFirst
          ? [`${PKG}-linux-${arch}-musl`, `${PKG}-linux-${arch}`]
          : [`${PKG}-linux-${arch}`, `${PKG}-linux-${arch}-musl`]
        : [`${PKG}-${platform}-${arch}`];
  return dirs.map((d) => `${d}/${exe}`);
}

export interface ResolveExecutableDeps {
  /** Reports whether a path exists on disk (fs.existsSync). */
  exists: (p: string) => boolean;
  /** app.getAppPath() — `.../resources/app.asar` when packaged. */
  appPath?: string | null;
  /** require.resolve, or null where unavailable. */
  resolve?: ((spec: string) => string) | null;
  platform?: string;
  arch?: string;
  muslFirst?: boolean;
}

/**
 * Locate a spawnable Claude Code CLI binary.
 *
 * The SDK resolves its own bundled binary with require.resolve and spawns the
 * result verbatim. Inside a packaged Electron app that path lands in app.asar
 * and the spawn dies with ENOTDIR, which surfaces as a synchronous throw out of
 * query(). Resolving it ourselves — and un-asar'ing it — lets us hand the SDK a
 * real path via options.pathToClaudeCodeExecutable.
 *
 * Returns null when nothing is found, in which case the caller should leave the
 * option unset and let the SDK fall back to its own resolution.
 */
export function resolveClaudeExecutable(deps: ResolveExecutableDeps): string | null {
  const { exists, appPath = null, resolve = null } = deps;
  const platform = deps.platform ?? process.platform;
  const arch = deps.arch ?? process.arch;
  const muslFirst = deps.muslFirst ?? isMuslLinux(platform);

  for (const spec of binaryCandidates(platform, arch, muslFirst)) {
    const found: string[] = [];
    if (appPath) found.push(joinPath(appPath, 'node_modules', ...spec.split('/')));
    if (resolve) {
      try { found.push(resolve(spec)); } catch { /* not installed for this platform */ }
    }
    for (const raw of found) {
      // Prefer the unpacked twin: inside a packaged app the asar path "exists"
      // per Electron's fs shim but cannot be exec'd.
      const unpacked = unpackedAsarPath(raw);
      if (unpacked !== raw && exists(unpacked)) return unpacked;
      if (exists(raw)) return raw;
    }
  }
  return null;
}
