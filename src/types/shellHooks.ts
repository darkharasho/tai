export interface PreexecHook {
  hook: 'preexec';
  command: string;
}

export interface PrecmdHook {
  hook: 'precmd';
  exit: number;
  signal: string | null;
  duration_ms: number;
  command: string;
  cwd: string;
}

export type ShellHook = PreexecHook | PrecmdHook;

export const OSC6973_PREFIX = '\x1b]6973;';
export const OSC6973_TERMINATOR = '\x07';
