import { describe, it, expect } from 'vitest';
import { redactSecrets, redactHistoryEntries } from '../../src/utils/redactSecrets';

const PLACEHOLDER = '«redacted»';

describe('redactSecrets', () => {
  it('redacts AWS access key IDs', () => {
    const out = redactSecrets('key is AKIAIOSFODNN7EXAMPLE here');
    expect(out).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(out).toContain(PLACEHOLDER);
  });

  it('redacts GitHub personal access tokens', () => {
    const out = redactSecrets('token ghp_1234567890abcdefghijklmnopqrstuvwx done');
    expect(out).not.toContain('ghp_1234567890abcdefghijklmnopqrstuvwx');
    expect(out).toContain(PLACEHOLDER);
  });

  it('redacts Slack tokens', () => {
    const out = redactSecrets('xoxb-123456789012-1234567890123-AbCdEfGhIjKlMnOpQrStUvWx');
    expect(out).not.toContain('xoxb-123456789012');
  });

  it('redacts the value of an Authorization: Bearer header', () => {
    const out = redactSecrets('Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc.def');
    expect(out).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc.def');
    expect(out).toContain(PLACEHOLDER);
  });

  it('redacts a standalone JWT', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    const out = redactSecrets(`session=${jwt}`);
    expect(out).not.toContain(jwt);
  });

  it('redacts env-style SECRET/TOKEN/PASSWORD/API_KEY assignments, keeping the name', () => {
    const out = redactSecrets('export AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY');
    expect(out).toContain('AWS_SECRET_ACCESS_KEY=');
    expect(out).not.toContain('wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY');
    expect(out).toContain(PLACEHOLDER);
  });

  it('redacts PEM private-key blocks', () => {
    const pem = '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAA\nAAAA\n-----END OPENSSH PRIVATE KEY-----';
    const out = redactSecrets(`here is the key:\n${pem}\nthanks`);
    expect(out).not.toContain('b3BlbnNzaC1rZXktdjEAAAA');
    expect(out).toContain(PLACEHOLDER);
    expect(out).toContain('here is the key:');
    expect(out).toContain('thanks');
  });

  it('leaves ordinary text untouched', () => {
    const text = 'npm test\nAll 269 tests passed in 2.3s\ncd ~/projects/tai';
    expect(redactSecrets(text)).toBe(text);
  });

  it('handles empty / undefined input', () => {
    expect(redactSecrets('')).toBe('');
    expect(redactSecrets(undefined as unknown as string)).toBe('');
  });
});

describe('redactHistoryEntries', () => {
  it('redacts command and output fields, preserving structure', () => {
    const entries = [
      {
        command: 'export GITHUB_TOKEN=ghp_1234567890abcdefghijklmnopqrstuvwx',
        output: 'ok',
        exitCode: 0,
        cwd: '/home/u/p',
      },
      {
        command: 'echo done',
        output: 'AKIAIOSFODNN7EXAMPLE',
        exitCode: 0,
      },
    ];
    const out = redactHistoryEntries(entries);
    expect(out[0].command).not.toContain('ghp_1234567890abcdefghijklmnopqrstuvwx');
    expect(out[0].command).toContain('GITHUB_TOKEN=');
    expect(out[0].cwd).toBe('/home/u/p');
    expect(out[0].exitCode).toBe(0);
    expect(out[1].output).not.toContain('AKIAIOSFODNN7EXAMPLE');
    // Does not mutate the input.
    expect(entries[1].output).toBe('AKIAIOSFODNN7EXAMPLE');
  });
});
