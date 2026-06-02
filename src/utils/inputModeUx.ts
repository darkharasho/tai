import type { InputType } from '@/utils/commandDetector';

/**
 * In AI mode, a leading '!' forces a one-off shell command (Warp-style):
 * the '!' is stripped and the caller switches to shell. In shell mode the
 * input is untouched so the shell's own '!' history expansion is preserved.
 */
export function stripForceShellPrefix(
  mode: InputType,
  value: string,
): { value: string; forceShell: boolean } {
  if (mode === 'ai' && value.startsWith('!')) {
    return { value: value.slice(1), forceShell: true };
  }
  return { value, forceShell: false };
}

/** The "auto" provenance chip shows only while autodetect governs a non-empty input. */
export function shouldShowAutoBadge(value: string, manualOverride: boolean): boolean {
  return value.trim().length > 0 && !manualOverride;
}
