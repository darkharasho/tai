import { describe, it, expect } from 'vitest';
import { sdkOptions, HISTORY_TOOL, REMOTE_DISALLOWED } from '../../electron/services/claudeSdkOptions';

const base = { model: 'default', cwd: '/home/u', sessionId: null, remoteExec: false, mcpServers: { 'tai-history': {} } };

describe('sdkOptions', () => {
  it('ask mode → default permission, history tool auto-allowed, no model when default', () => {
    const r = sdkOptions({ ...base, permMode: 'ask' });
    expect(r.permissionMode).toBe('default');
    expect(r.allowedTools).toContain(HISTORY_TOOL);
    expect(r.model).toBeUndefined();
    expect(r.cwd).toBe('/home/u');
    expect(r.mcpServers).toEqual({ 'tai-history': {} });
  });

  it('acceptEdits mode → acceptEdits permission', () => {
    expect(sdkOptions({ ...base, permMode: 'acceptEdits' }).permissionMode).toBe('acceptEdits');
  });

  it('bypass mode → bypassPermissions + allowDangerouslySkipPermissions', () => {
    const r = sdkOptions({ ...base, permMode: 'bypass' });
    expect(r.permissionMode).toBe('bypassPermissions');
    expect(r.allowDangerouslySkipPermissions).toBe(true);
  });

  it('remoteExec → bypassPermissions and built-in tools disallowed', () => {
    const r = sdkOptions({ ...base, permMode: 'acceptEdits', remoteExec: true });
    expect(r.permissionMode).toBe('bypassPermissions');
    expect(r.allowDangerouslySkipPermissions).toBe(true);
    expect(r.disallowedTools).toEqual(REMOTE_DISALLOWED);
  });

  it('passes an explicit model through and omits "default"', () => {
    expect(sdkOptions({ ...base, permMode: 'ask', model: 'opus' }).model).toBe('opus');
    expect(sdkOptions({ ...base, permMode: 'ask', model: 'default' }).model).toBeUndefined();
  });

  it('sets resume from a non-null sessionId', () => {
    expect(sdkOptions({ ...base, permMode: 'ask', sessionId: 'sess-1' }).resume).toBe('sess-1');
    expect(sdkOptions({ ...base, permMode: 'ask', sessionId: null }).resume).toBeUndefined();
  });
});
