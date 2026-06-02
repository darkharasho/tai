import { describe, it, expect } from 'vitest';
import { parseInteractiveSshCommand, checkSshLoginState } from '../../src/utils/sshDetect';

describe('parseInteractiveSshCommand', () => {
  it('parses a bare host', () => {
    expect(parseInteractiveSshCommand('ssh host')).toEqual({ host: 'host', port: null });
  });

  it('parses user@host', () => {
    expect(parseInteractiveSshCommand('ssh user@host')).toEqual({ host: 'user@host', port: null });
  });

  it('captures the -p port and keeps the host', () => {
    expect(parseInteractiveSshCommand('ssh -p 2222 host')).toEqual({ host: 'host', port: '2222' });
  });

  it('skips an option argument so it is not read as the host', () => {
    expect(parseInteractiveSshCommand('ssh -i ~/.ssh/key user@host')).toEqual({
      host: 'user@host',
      port: null,
    });
  });

  it('handles -o KEY=VALUE without consuming the host', () => {
    expect(parseInteractiveSshCommand('ssh -o StrictHostKeyChecking=no host')).toEqual({
      host: 'host',
      port: null,
    });
  });

  it('rejects a one-shot remote command (second positional)', () => {
    expect(parseInteractiveSshCommand('ssh host ls')).toBeNull();
  });

  it('rejects a quoted one-shot remote command', () => {
    expect(parseInteractiveSshCommand("ssh user@host 'sudo reboot'")).toBeNull();
  });

  it('rejects -T (no pseudo-tty, e.g. git over ssh)', () => {
    expect(parseInteractiveSshCommand('ssh -T git@github.com')).toBeNull();
  });

  it('rejects -W (stdio forward / jump)', () => {
    expect(parseInteractiveSshCommand('ssh -W host:22 jump')).toBeNull();
  });

  it('strips a leading `command ` builtin prefix', () => {
    expect(parseInteractiveSshCommand('command ssh host')).toEqual({ host: 'host', port: null });
  });

  it('returns null for non-ssh and malformed input', () => {
    expect(parseInteractiveSshCommand('ls')).toBeNull();
    expect(parseInteractiveSshCommand('')).toBeNull();
    expect(parseInteractiveSshCommand('sshfoo host')).toBeNull();
    expect(parseInteractiveSshCommand('ssh')).toBeNull();
    expect(parseInteractiveSshCommand("ssh 'unterminated")).toBeNull();
  });

  it('recognizes ssh-like wrappers with an unknown host', () => {
    expect(parseInteractiveSshCommand('gcloud compute ssh my-vm')).toEqual({ host: null, port: null });
    expect(parseInteractiveSshCommand('eb ssh my-env')).toEqual({ host: null, port: null });
    expect(parseInteractiveSshCommand('doctl compute ssh droplet')).toEqual({ host: null, port: null });
  });
});

describe('checkSshLoginState', () => {
  it('detects the Last login banner', () => {
    expect(checkSshLoginState('Last login: Mon Jun  1 10:00:00 2026 from 10.0.0.1')).toBe('last-login');
  });

  it('detects a password prompt as authenticating', () => {
    expect(checkSshLoginState("user@host's password: ")).toBe('authenticating');
  });

  it('detects a passphrase prompt as authenticating', () => {
    expect(checkSshLoginState('Enter passphrase for key /home/u/.ssh/id_ed25519: ')).toBe('authenticating');
  });

  it('detects a trust-on-first-use yes/no prompt as authenticating', () => {
    expect(
      checkSshLoginState('Are you sure you want to continue connecting (yes/no/[fingerprint])? '),
    ).toBe('authenticating');
  });

  it('detects a FIDO presence prompt as authenticating', () => {
    expect(checkSshLoginState('Confirm user presence for key ED25519-SK')).toBe('authenticating');
  });

  it('detects a shell prompt char on the last line', () => {
    expect(checkSshLoginState('motd line\nuser@host:~$ ')).toBe('prompt-detected');
  });

  it('classifies ordinary output as non-ssh-output', () => {
    expect(checkSshLoginState('some build log line\nanother line')).toBe('non-ssh-output');
  });
});
