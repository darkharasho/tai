import { PasswordField } from './PasswordField';

interface PasswordPromptProps {
  ptyId: number;
  onDone: () => void;
}

/** Terminal sudo: keystrokes go to the PTY as they are typed. */
export function PasswordPrompt({ ptyId, onDone }: PasswordPromptProps) {
  return (
    <PasswordField
      onChar={(c) => window.tai?.pty?.write(ptyId, c)}
      onBackspace={() => window.tai?.pty?.write(ptyId, '\x7f')}
      onSubmit={(secret, remember) => {
        if (remember && secret.length > 0) window.tai?.pty?.rememberSecret?.(secret);
        window.tai?.pty?.write(ptyId, '\n');
        onDone();
      }}
      onCancel={() => {
        window.tai?.pty?.write(ptyId, '\x03');
        onDone();
      }}
    />
  );
}
