import { useEffect, useRef, type RefObject } from 'react';
import { focusTargetFor, type InputSurface } from '@/utils/inputSurface';

interface Focusable {
  focus: () => void;
  blur?: () => void;
}

interface SessionFocusOptions {
  visible: boolean;
  surface: InputSurface;
  /** An AI sudo password field is pending in this session. */
  aiNeedsInput: boolean;
  rootRef: RefObject<HTMLElement | null>;
  composerRef: RefObject<Focusable | null>;
  xtermRef: RefObject<Focusable | null>;
}

/** Focus the newest pending AI sudo password field inside `root`. */
export function focusPendingSudoField(root: HTMLElement | null): boolean {
  const fields = root?.querySelectorAll<HTMLElement>('[data-testid="sudo-prompt"] [data-testid="password-field"]');
  const field = fields && fields.length > 0 ? fields[fields.length - 1] : null;
  if (!field) return false;
  field.focus();
  return true;
}

/**
 * The session's focus-restoring effects: on becoming visible, and whenever the
 * input surface changes. Kept out of TerminalSession so it can be tested.
 */
export function useSessionFocus({ visible, surface, aiNeedsInput, rootRef, composerRef, xtermRef }: SessionFocusOptions): void {
  // Read by the visibility effect without making a sudo prompt arriving or
  // resolving count as "became visible".
  const aiNeedsInputRef = useRef(aiNeedsInput);
  aiNeedsInputRef.current = aiNeedsInput;

  useEffect(() => {
    if (!visible) return;
    requestAnimationFrame(() => {
      // Never pull focus to the composer while an AI sudo field is pending — a
      // password typed there would be sent to the AI. Focus the field instead.
      if (aiNeedsInputRef.current) focusPendingSudoField(rootRef.current);
      else composerRef.current?.focus();
    });
  }, [visible]);

  useEffect(() => {
    // While a sudo field is pending it owns the keyboard: moving focus to the
    // composer would send the password to the AI, to the xterm would send it
    // to the PTY. Re-runs when the prompt resolves, restoring the surface.
    if (aiNeedsInput) return;
    const target = focusTargetFor(surface);
    if (target === 'composer') {
      requestAnimationFrame(() => composerRef.current?.focus());
    } else if (target === 'xterm') {
      composerRef.current?.blur?.();
      requestAnimationFrame(() => xtermRef.current?.focus());
    } else {
      // tier1: the card's own line/password input self-focuses (CommandBlock effect).
      composerRef.current?.blur?.();
    }
  }, [surface, aiNeedsInput]);
}
