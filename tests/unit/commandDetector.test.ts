import { describe, it, expect } from 'vitest';
import { looksLikeShellCommand } from '@/utils/commandDetector';
import { classifyInput, CONFIDENCE, FLIP_THRESHOLD } from '@/utils/commandDetector';

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

describe('classifyInput', () => {
  it('flags wrapped agent CLIs as high-confidence shell', () => {
    const r = classifyInput('claude how do I fix this');
    expect(r.type).toBe('shell');
    expect(r.confidence).toBe(CONFIDENCE.HIGH);
    expect(r.source).toBe('agent-cli');
  });

  it('flags explicit shell syntax as high-confidence shell', () => {
    expect(classifyInput('cat f | grep x').source).toBe('shell-syntax');
    expect(classifyInput('./run.sh').source).toBe('shell-syntax');
    expect(classifyInput('NODE_ENV=prod npm start').source).toBe('shell-syntax');
    expect(classifyInput('tool --verbose').source).toBe('shell-syntax');
    expect(classifyInput('cat f | grep x').type).toBe('shell');
    expect(classifyInput('cat f | grep x').confidence).toBe(CONFIDENCE.HIGH);
  });

  it('flags a question mark as high-confidence ai', () => {
    const r = classifyInput('is this a bug?');
    expect(r.type).toBe('ai');
    expect(r.confidence).toBe(CONFIDENCE.HIGH);
    expect(r.source).toBe('question-mark');
  });

  it('flags a known command as high-confidence shell', () => {
    const r = classifyInput('git status');
    expect(r.type).toBe('shell');
    expect(r.source).toBe('known-command');
  });

  it('flags an NL starter as high-confidence ai', () => {
    expect(classifyInput('how do I deploy').source).toBe('nl-starter');
    expect(classifyInput('explain this code').type).toBe('ai');
  });

  it('flags a pronoun as high-confidence ai', () => {
    const r = classifyInput('I need help with auth');
    expect(r.type).toBe('ai');
    expect(r.source).toBe('nl-pronoun');
  });

  it('uses NL word scoring for longer conversational input', () => {
    const r = classifyInput('this looks pretty good and that was really nice');
    expect(r.type).toBe('ai');
    expect(r.confidence).toBe(CONFIDENCE.MED);
    expect(r.source).toBe('nl-word-score');
  });

  it('classifies a bare unknown token as low-confidence shell', () => {
    const r = classifyInput('mytool');
    expect(r.type).toBe('shell');
    expect(r.confidence).toBe(CONFIDENCE.LOW);
    expect(r.source).toBe('short-token');
  });

  it('handles an incomplete last token (mid-word) as ai', () => {
    const r = classifyInput('that was really goo');
    expect(r.type).toBe('ai');
    expect(r.source).toBe('nl-word-score');
  });

  it('sticks to the current mode on ambiguous input', () => {
    const ambiguous = 'foo bar baz qux';
    expect(classifyInput(ambiguous, { currentMode: 'ai' }).type).toBe('ai');
    expect(classifyInput(ambiguous, { currentMode: 'shell' }).type).toBe('shell');
    expect(classifyInput(ambiguous, { currentMode: 'ai' }).source).toBe('sticky-fallback');
  });

  it('returns the empty source for blank input', () => {
    expect(classifyInput('').source).toBe('empty');
    expect(classifyInput('').type).toBe('ai');
  });

  it('exposes tunable constants', () => {
    expect(CONFIDENCE.HIGH).toBeGreaterThan(FLIP_THRESHOLD);
    expect(CONFIDENCE.MED).toBeGreaterThanOrEqual(FLIP_THRESHOLD);
    expect(CONFIDENCE.LOW).toBeLessThan(FLIP_THRESHOLD);
  });
});
