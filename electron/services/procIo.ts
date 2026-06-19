// Writing to a dead child's stdin throws (EPIPE) — guard so a crashed provider
// surfaces an error instead of silently swallowing the user's prompt.
export function safeWrite(
  proc: { stdin: NodeJS.WritableStream | null } | null,
  data: string,
  onError?: (err: Error) => void,
): boolean {
  const stdin = proc?.stdin;
  if (!stdin) {
    onError?.(new Error('stdin not available'));
    return false;
  }
  try {
    stdin.write(data);
    return true;
  } catch (err) {
    onError?.(err instanceof Error ? err : new Error(String(err)));
    return false;
  }
}
