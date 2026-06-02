// Resolves the effective remote target for a terminal tab, letting a manual
// user override take precedence over heuristic autodetection. This is the
// escape hatch for the long tail the SSH command parser deliberately can't
// catch (aliased ssh, mosh, jump-host chains, unrecognized wrappers) — the
// equivalent of Warp's manual "Warpify SSH Session" action.

export interface EffectiveRemote {
  isRemote: boolean;
  sshTarget: string | null;
  source: 'auto' | 'manual';
}

export function resolveEffectiveRemote(
  autoIsRemote: boolean,
  autoTarget: string | null,
  manualTarget: string | null,
): EffectiveRemote {
  const manual = manualTarget?.trim();
  if (manual) {
    return { isRemote: true, sshTarget: manual, source: 'manual' };
  }
  return { isRemote: autoIsRemote, sshTarget: autoTarget ?? null, source: 'auto' };
}
