// Per-tab remote-AI state for the interactive-ssh "AI on this host" pill.
// Pure + fully testable; TerminalSession owns one instance and orchestrates the
// async install. Watch needs no helper (local execution + remote context); the
// daemon install is deferred to the first switch to run.

export type RemoteAiMode = 'off' | 'watch' | 'run';

export interface RemoteAiState {
  sshActive: boolean;
  target: string | null;
  mode: RemoteAiMode;
  installing: boolean;
  helperInstalled: boolean;
  dismissed: boolean;
  error: string | null;
}

export interface RememberedHost {
  mode: RemoteAiMode;
  helperInstalled: boolean;
  dismissed: boolean;
}

export type PillView =
  | { kind: 'hidden' }
  | { kind: 'offer'; target: string }
  | { kind: 'installing'; target: string }
  | { kind: 'active'; target: string; mode: 'watch' | 'run'; error: string | null };

export function initialRemoteAi(): RemoteAiState {
  return {
    sshActive: false,
    target: null,
    mode: 'off',
    installing: false,
    helperInstalled: false,
    dismissed: false,
    error: null,
  };
}

export function pillView(s: RemoteAiState): PillView {
  if (!s.sshActive || !s.target) return { kind: 'hidden' };
  if (s.installing) return { kind: 'installing', target: s.target };
  if (s.mode === 'watch' || s.mode === 'run') {
    return { kind: 'active', target: s.target, mode: s.mode, error: s.error };
  }
  if (s.dismissed) return { kind: 'hidden' };
  return { kind: 'offer', target: s.target };
}

export function onSshChange(
  s: RemoteAiState,
  active: boolean,
  target: string | null,
  remembered?: RememberedHost,
): RemoteAiState {
  if (!active || !target) return initialRemoteAi();
  return {
    ...initialRemoteAi(),
    sshActive: true,
    target,
    mode: remembered?.mode ?? 'off',
    helperInstalled: remembered?.helperInstalled ?? false,
    dismissed: remembered?.dismissed ?? false,
  };
}

export function enableWatch(s: RemoteAiState): RemoteAiState {
  return { ...s, mode: 'watch', dismissed: false, error: null };
}

export function setMode(s: RemoteAiState, mode: RemoteAiMode): RemoteAiState {
  return { ...s, mode, error: null };
}

export function setInstalling(s: RemoteAiState, installing: boolean): RemoteAiState {
  return { ...s, installing };
}

export function setHelperInstalled(s: RemoteAiState, ok: boolean): RemoteAiState {
  return { ...s, helperInstalled: ok };
}

export function dismissOffer(s: RemoteAiState): RemoteAiState {
  return { ...s, dismissed: true };
}

export function setError(s: RemoteAiState, error: string | null): RemoteAiState {
  // An error only surfaces in the active view; ensure we are at least in watch.
  return { ...s, error, installing: false, mode: s.mode === 'off' ? 'watch' : s.mode };
}
