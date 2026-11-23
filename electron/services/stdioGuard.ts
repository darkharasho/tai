// Launched from a desktop launcher or a terminal that has since closed, the
// app's stdout/stderr can be a dead pipe. Any console.* in the main process —
// ours or a dependency's (electron-updater logs "update available" with
// console.info) — then fails with EPIPE, and with no 'error' listener on the
// stream that becomes an uncaught exception dialog. Logging is best-effort;
// drop the write instead.
const IGNORED = new Set(['EPIPE', 'EIO', 'ERR_STREAM_DESTROYED']);

type Stream = Pick<NodeJS.EventEmitter, 'on'>;

export function guardStdio(streams: Stream[] = [process.stdout, process.stderr]): void {
  for (const s of streams) {
    s?.on('error', (err: NodeJS.ErrnoException) => {
      if (err && IGNORED.has(err.code ?? '')) return;
      // Anything else is unexpected; surface it the way Node would have.
      throw err;
    });
  }
}
