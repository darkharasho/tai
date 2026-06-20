export type PermissionResult = { behavior: 'allow' } | { behavior: 'deny'; message: string };

const DENY: PermissionResult = { behavior: 'deny', message: 'User denied the tool use.' };

/**
 * Bridges the SDK's canUseTool callback to the renderer's ai:approve IPC.
 * canUseTool calls `request(toolUseId)` and awaits the returned promise; the
 * renderer's Approve/Deny button drives `resolve(toolUseId, approved)`.
 */
export class ApprovalBridge {
  private _pending = new Map<string, (r: PermissionResult) => void>();

  request(toolUseId: string): Promise<PermissionResult> {
    return new Promise<PermissionResult>((resolve) => {
      this._pending.set(toolUseId, resolve);
    });
  }

  resolve(toolUseId: string, approved: boolean): boolean {
    const fn = this._pending.get(toolUseId);
    if (!fn) return false;
    this._pending.delete(toolUseId);
    fn(approved ? { behavior: 'allow' } : DENY);
    return true;
  }

  clear(): void {
    for (const fn of this._pending.values()) fn(DENY);
    this._pending.clear();
  }
}
