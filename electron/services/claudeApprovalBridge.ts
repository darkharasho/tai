export type PermissionResult =
  | { behavior: 'allow'; updatedInput?: Record<string, unknown> }
  | { behavior: 'deny'; message: string };

const DENY: PermissionResult = { behavior: 'deny', message: 'User denied the tool use.' };

/**
 * Bridges the SDK's canUseTool callback to the renderer's ai:approve IPC.
 * canUseTool calls `request(toolUseId)` and awaits the returned promise; the
 * renderer's Approve/Deny button drives `resolve(toolUseId, approved)`.
 *
 * `updatedInput` is how an answer gets back to a tool: the CLI re-reads the
 * input we hand back, so AskUserQuestion picks up the user's choice from an
 * `answers` map rather than reporting that nobody answered.
 */
export class ApprovalBridge {
  private _pending = new Map<string, (r: PermissionResult) => void>();

  request(toolUseId: string): Promise<PermissionResult> {
    return new Promise<PermissionResult>((resolve) => {
      this._pending.set(toolUseId, resolve);
    });
  }

  resolve(toolUseId: string, approved: boolean, updatedInput?: Record<string, unknown> | null): boolean {
    const fn = this._pending.get(toolUseId);
    if (!fn) return false;
    this._pending.delete(toolUseId);
    fn(approved ? { behavior: 'allow', ...(updatedInput ? { updatedInput } : {}) } : DENY);
    return true;
  }

  clear(): void {
    for (const fn of this._pending.values()) fn(DENY);
    this._pending.clear();
  }
}
