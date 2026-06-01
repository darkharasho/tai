import type { ShellHook } from '@/types/shellHooks';
import { OSC6973_PREFIX, OSC6973_TERMINATOR } from '@/types/shellHooks';

export function parseOsc6973(hex: string): ShellHook | null {
  if (!/^[0-9a-fA-F]*$/.test(hex) || hex.length % 2 !== 0) return null;
  let json: string;
  try {
    json = Buffer.from(hex, 'hex').toString('utf8');
  } catch {
    return null;
  }
  let obj: unknown;
  try {
    obj = JSON.parse(json);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object') return null;
  const hook = (obj as { hook?: unknown }).hook;
  if (hook !== 'preexec' && hook !== 'precmd') return null;

  // Validate required fields based on hook type
  if (hook === 'preexec') {
    if (typeof (obj as any).command !== 'string') return null;
  } else if (hook === 'precmd') {
    if (typeof (obj as any).command !== 'string') return null;
    if (typeof (obj as any).exit !== 'number') return null;
    if (typeof (obj as any).duration_ms !== 'number') return null;
    if (typeof (obj as any).cwd !== 'string') return null;
    const signal = (obj as any).signal;
    if (signal !== null && typeof signal !== 'string') return null;
  }

  return obj as ShellHook;
}

export function encodeOsc6973(payload: ShellHook): string {
  const hex = Buffer.from(JSON.stringify(payload), 'utf8').toString('hex');
  return `${OSC6973_PREFIX}${hex}${OSC6973_TERMINATOR}`;
}
