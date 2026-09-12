import { PasswordField } from './PasswordField';

interface SudoPromptProps {
  requestId: string;
  prompt: string;
}

/**
 * AI sudo: nothing reaches a terminal. The whole secret goes to the main
 * process on Enter, which hands it to sudo through the askpass broker.
 */
export function SudoPrompt({ requestId, prompt }: SudoPromptProps) {
  return (
    <div>
      {prompt && (
        <div style={{ margin: '0 14px 4px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: '11px' }}>
          {prompt}
        </div>
      )}
      <PasswordField
        cancelOnEscape
        onSubmit={(secret, remember) => window.tai?.ai?.sudoAnswer?.(requestId, secret, remember)}
        onCancel={() => window.tai?.ai?.sudoCancel?.(requestId)}
      />
    </div>
  );
}
