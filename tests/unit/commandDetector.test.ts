import { describe, it, expect } from 'vitest';
import { looksLikeShellCommand } from '@/utils/commandDetector';

describe('looksLikeShellCommand', () => {
  it('recognizes known commands', () => {
    expect(looksLikeShellCommand('ls -la')).toBe(true);
    expect(looksLikeShellCommand('git status')).toBe(true);
    expect(looksLikeShellCommand('docker compose up -d')).toBe(true);
  });

  it('recognizes path-like patterns', () => {
    expect(looksLikeShellCommand('./script.sh')).toBe(true);
    expect(looksLikeShellCommand('~/bin/tool')).toBe(true);
    expect(looksLikeShellCommand('/usr/bin/env python')).toBe(true);
  });

  it('recognizes env variable assignments', () => {
    expect(looksLikeShellCommand('NODE_ENV=production npm start')).toBe(true);
  });

  it('recognizes shell operators', () => {
    expect(looksLikeShellCommand('cat file | grep pattern')).toBe(true);
    expect(looksLikeShellCommand('echo hello > file.txt')).toBe(true);
  });

  it('detects natural language questions', () => {
    expect(looksLikeShellCommand('how do I fix this error?')).toBe(false);
    expect(looksLikeShellCommand('what is the best way to deploy')).toBe(false);
    expect(looksLikeShellCommand('explain this code')).toBe(false);
  });

  it('detects conversational input', () => {
    expect(looksLikeShellCommand('I need help with the auth system')).toBe(false);
    expect(looksLikeShellCommand('can you refactor this function')).toBe(false);
    expect(looksLikeShellCommand('thanks that looks good')).toBe(false);
  });

  it('handles edge cases', () => {
    expect(looksLikeShellCommand('')).toBe(false);
    expect(looksLikeShellCommand('a')).toBe(false);
    expect(looksLikeShellCommand('npm')).toBe(true);
  });

  it('recognizes flags as shell signals', () => {
    expect(looksLikeShellCommand('something --verbose')).toBe(true);
    expect(looksLikeShellCommand('tool -v')).toBe(true);
  });

  it('detects question marks as natural language', () => {
    expect(looksLikeShellCommand('is this a bug?')).toBe(false);
  });

  it('treats wrapped agent CLIs as shell commands, never AI', () => {
    // TAI wraps claude/codex/gemini; classifying a launch of one of these as
    // natural language would misroute it into the AI provider instead of the
    // CLI the user is trying to run. Always shell, even with NL-looking args.
    expect(looksLikeShellCommand('claude how do I fix this')).toBe(true);
    expect(looksLikeShellCommand('gemini what is the weather')).toBe(true);
    expect(looksLikeShellCommand('codex can you refactor this')).toBe(true);
    expect(looksLikeShellCommand('claude')).toBe(true);
    // The agent guardrail must win even over the question-mark NL signal.
    expect(looksLikeShellCommand('claude how do I fix this?')).toBe(true);
  });
});
