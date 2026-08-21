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

describe('classifyInput — NL stemming/coverage', () => {
  it('classifies inflected/expanded conversational phrases as AI', () => {
    // "changes" stems to "change"; "onto"/"latest" newly covered.
    expect(classifyInput('rebasing onto the latest changes').type).toBe('ai');
    // adding "everything" tips a phrase that previously fell just short.
    expect(classifyInput('everything looks good but the deploy failed').type).toBe('ai');
  });

  it('matches inflected forms of existing NL words via stemming', () => {
    // "wanting"/"knowing" stem to want/know which are already in the set.
    expect(classifyInput('wanting to be knowing the reason').type).toBe('ai');
  });

  it('does not misclassify real shell commands as AI', () => {
    expect(classifyInput('git rebase main').type).toBe('shell');
    expect(classifyInput('npm run build').type).toBe('shell');
    expect(classifyInput('docker compose up -d').type).toBe('shell');
    expect(classifyInput('kubectl get pods').type).toBe('shell');
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

describe('ambiguous commands that are also English verbs', () => {
  it.each([
    'find the bug in auth.ts',
    'find my keys',
    'make it faster',
    'make a backup of this',
    'which approach is better',
    'which of these is faster',
  ])('reads as AI when the rest of the input is a sentence: %s', (input) => {
    const r = classifyInput(input);
    expect(r.type).toBe('ai');
    expect(r.source).toBe('ambiguous-command');
    expect(r.confidence).toBe(CONFIDENCE.MED);
  });

  // The reason these three cannot simply be demoted below `nl-starter`.
  it.each([
    'find src',
    'make build',
    'make clean',
    'which node',
  ])('stays a shell command when the rest of the input is not: %s', (input) => {
    const r = classifyInput(input);
    expect(r.type).toBe('shell');
    expect(r.source).toBe('known-command');
  });

  // Flags and paths are caught several rungs earlier and never reach here.
  it.each(['find . -name "*.ts"', 'make -j8', 'find src -type f'])(
    'is decided by syntax before ambiguity matters: %s',
    (input) => {
      expect(classifyInput(input).source).toBe('shell-syntax');
    },
  );

  it('leaves the other 181 known commands untouched', () => {
    expect(classifyInput('git the thing').source).toBe('known-command');
    expect(classifyInput('cat the summary').source).toBe('known-command');
  });
});

describe('learned corrections', () => {
  const learned = (m: Record<string, 'shell' | 'ai'>) =>
    ({ learned: new Map(Object.entries(m)) as ReadonlyMap<string, 'shell' | 'ai'> });

  it('overrides the ambiguous-command verdict when the user has taught it otherwise', () => {
    const r = classifyInput('find the config', learned({ find: 'shell' }));
    expect(r.type).toBe('shell');
    expect(r.source).toBe('learned');
    expect(r.confidence).toBe(CONFIDENCE.HIGH);
  });

  it('overrides a known command in the other direction', () => {
    // A personal script named `explain`, or a habit of asking AI to `find`.
    const r = classifyInput('cat the summary', learned({ cat: 'ai' }));
    expect(r.type).toBe('ai');
    expect(r.source).toBe('learned');
  });

  it('leaves untaught tokens on their original rung', () => {
    expect(classifyInput('find the config', learned({ grep: 'ai' })).source).toBe('ambiguous-command');
    expect(classifyInput('explain this to me', learned({ grep: 'ai' })).source).toBe('nl-starter');
  });

  it('keys on the first token only', () => {
    const r = classifyInput('ls find', learned({ find: 'ai' }));
    expect(r.source).toBe('known-command');
    expect(r.type).toBe('shell');
  });

  // The syntax rungs assert facts about the string. `learned` asserts a
  // preference about a vocabulary item, and must never beat a fact.
  it('never beats shell syntax, an agent CLI, or a question mark', () => {
    expect(classifyInput('git log | grep foo', learned({ git: 'ai' })).source).toBe('shell-syntax');
    expect(classifyInput('./deploy now', learned({ deploy: 'ai' })).source).toBe('shell-syntax');
    expect(classifyInput('what is find?', learned({ what: 'shell' })).source).toBe('question-mark');
    expect(classifyInput('claude fix this', learned({ claude: 'ai' })).source).toBe('agent-cli');
  });
});

describe('PATH binaries', () => {
  const onPath = (...names: string[]) => ({ pathBinaries: new Set(names) as ReadonlySet<string> });

  // The point of the rung. KNOWN_COMMANDS covers 184 of the ~4000 binaries on
  // PATH; the rest reach sticky-fallback at LOW (0.55), under FLIP_THRESHOLD,
  // so the composer never auto-flips for them. Note `Rscript` also pins the
  // case-sensitivity of the lookup.
  it('lifts an unknown binary from LOW to MED so the composer auto-flips', () => {
    const before = classifyInput('Rscript analyse.R');
    expect(before.source).toBe('sticky-fallback');
    expect(before.confidence).toBeLessThan(FLIP_THRESHOLD);

    const after = classifyInput('Rscript analyse.R', onPath('Rscript'));
    expect(after.type).toBe('shell');
    expect(after.source).toBe('path-binary');
    expect(after.confidence).toBe(CONFIDENCE.MED);
    expect(after.confidence).toBeGreaterThanOrEqual(FLIP_THRESHOLD);
  });

  // The reason the rung sits BELOW every natural-language rung. These four
  // words are real binaries on a stock Linux box AND natural-language starters,
  // and unlike find/make/which (Task 2) they are classified CORRECTLY today.
  // A high placement would break all four.
  it.each([
    'write the tests for this module',
    'convert this to typescript',
    'compare these two files for me',
    'who owns this service',
  ])('leaves an English sentence alone even when its verb is on PATH: %s', (input) => {
    const r = classifyInput(input, onPath('write', 'convert', 'compare', 'who'));
    expect(r.type).toBe('ai');
    expect(r.source).toBe('nl-starter');
  });

  // Task 2's three verbs must also survive the new rung.
  it('does not let PATH membership undo the ambiguous-command fix', () => {
    const r = classifyInput('find the bug in auth.ts', onPath('find', 'make', 'which'));
    expect(r.type).toBe('ai');
    expect(r.source).toBe('ambiguous-command');
  });

  it('does not fire for a token that is not on PATH', () => {
    expect(classifyInput('Rscript analyse.R', onPath('docker')).source).toBe('sticky-fallback');
  });
});

describe('additive-ness', () => {
  it('behaves identically with an empty context and with none at all', () => {
    for (const input of ['ls -la', 'how do I rebase', 'Rscript analyse.R', 'find the bug']) {
      expect(classifyInput(input, { learned: new Map(), pathBinaries: new Set() }))
        .toEqual(classifyInput(input));
    }
  });
});
