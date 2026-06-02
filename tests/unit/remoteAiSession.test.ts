import { describe, it, expect } from 'vitest';
import {
  initialRemoteAi, pillView, onSshChange, enableWatch, setMode,
  setInstalling, setHelperInstalled, dismissOffer, setError,
} from '../../src/utils/remoteAiSession';

describe('remoteAiSession', () => {
  it('starts hidden with no ssh', () => {
    expect(pillView(initialRemoteAi())).toEqual({ kind: 'hidden' });
  });

  it('shows the offer when an ssh session becomes active', () => {
    const s = onSshChange(initialRemoteAi(), true, 'piclock');
    expect(pillView(s)).toEqual({ kind: 'offer', target: 'piclock' });
  });

  it('enable goes straight to active/watch (no helper needed)', () => {
    const s = enableWatch(onSshChange(initialRemoteAi(), true, 'piclock'));
    expect(s.mode).toBe('watch');
    expect(pillView(s)).toEqual({ kind: 'active', target: 'piclock', mode: 'watch', error: null });
  });

  it('shows installing while a run-install is in flight', () => {
    let s = enableWatch(onSshChange(initialRemoteAi(), true, 'piclock'));
    s = setInstalling(s, true);
    expect(pillView(s)).toEqual({ kind: 'installing', target: 'piclock' });
  });

  it('switches to run once the helper is installed', () => {
    let s = enableWatch(onSshChange(initialRemoteAi(), true, 'piclock'));
    s = setHelperInstalled(setInstalling(s, false), true);
    s = setMode(s, 'run');
    expect(pillView(s)).toEqual({ kind: 'active', target: 'piclock', mode: 'run', error: null });
  });

  it('clears everything when the ssh session ends', () => {
    let s = enableWatch(onSshChange(initialRemoteAi(), true, 'piclock'));
    s = onSshChange(s, false, null);
    expect(pillView(s)).toEqual({ kind: 'hidden' });
    expect(s.mode).toBe('off');
  });

  it('hides the offer after dismissal but keeps ssh state', () => {
    let s = onSshChange(initialRemoteAi(), true, 'piclock');
    s = dismissOffer(s);
    expect(pillView(s)).toEqual({ kind: 'hidden' });
    expect(s.sshActive).toBe(true);
  });

  it('restores remembered mode/helper when re-entering a known host', () => {
    const s = onSshChange(initialRemoteAi(), true, 'piclock',
      { mode: 'run', helperInstalled: true, dismissed: false });
    expect(pillView(s)).toEqual({ kind: 'active', target: 'piclock', mode: 'run', error: null });
  });

  it('records an error and falls back to watch', () => {
    let s = enableWatch(onSshChange(initialRemoteAi(), true, 'piclock'));
    s = setError(setInstalling(s, false), 'install failed');
    expect(pillView(s)).toEqual({ kind: 'active', target: 'piclock', mode: 'watch', error: 'install failed' });
  });
});
