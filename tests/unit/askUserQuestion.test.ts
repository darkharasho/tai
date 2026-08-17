import { describe, it, expect } from 'vitest';
import { parseAskUserQuestion, withAnswers, joinAnswer, answerHasLabel } from '../../src/utils/askUserQuestion';

const payload = {
  questions: [{
    question: 'Confirm target: /dev/sda will be erased. Proceed?',
    header: 'Wipe /dev/sda',
    options: [
      { label: 'Yes, wipe /dev/sda', description: 'Erase the 231GB USB.' },
      { label: 'No, stop', description: 'Do not touch the drive.' },
    ],
    multiSelect: false,
  }],
};

describe('parseAskUserQuestion', () => {
  it('parses questions, headers, options and descriptions', () => {
    expect(parseAskUserQuestion(payload)).toEqual([{
      question: 'Confirm target: /dev/sda will be erased. Proceed?',
      header: 'Wipe /dev/sda',
      options: [
        { label: 'Yes, wipe /dev/sda', description: 'Erase the 231GB USB.' },
        { label: 'No, stop', description: 'Do not touch the drive.' },
      ],
      multiSelect: false,
    }]);
  });

  it('accepts the payload as a JSON string', () => {
    expect(parseAskUserQuestion(JSON.stringify(payload))).toEqual(parseAskUserQuestion(payload));
  });

  it('keeps multiSelect and tolerates missing header/description/options', () => {
    const out = parseAskUserQuestion({
      questions: [{ question: 'Which targets?', options: ['linux', { label: 'win' }], multiSelect: true }],
    });
    expect(out).toEqual([{
      question: 'Which targets?',
      header: undefined,
      options: [{ label: 'linux', description: undefined }, { label: 'win', description: undefined }],
      multiSelect: true,
    }]);
    expect(parseAskUserQuestion({ questions: [{ question: 'Bare?' }] })![0].options).toEqual([]);
  });

  it('skips malformed entries and returns null when nothing usable remains', () => {
    expect(parseAskUserQuestion({ questions: [{ question: '' }, null, 'nope'] })).toBeNull();
    expect(parseAskUserQuestion({ questions: [] })).toBeNull();
    expect(parseAskUserQuestion({ command: 'ls' })).toBeNull();
    expect(parseAskUserQuestion('not json')).toBeNull();
    expect(parseAskUserQuestion(null)).toBeNull();
  });

  it('drops option entries with no label', () => {
    const out = parseAskUserQuestion({ questions: [{ question: 'q', options: [{ description: 'orphan' }, ''] }] });
    expect(out![0].options).toEqual([]);
  });
});

describe('withAnswers', () => {
  it('keeps the original input and adds the answers map', () => {
    const answers = { 'Confirm target: /dev/sda will be erased. Proceed?': 'No, stop' };
    expect(withAnswers(payload, answers)).toEqual({ ...payload, answers });
  });

  it('parses a JSON-string input before folding the answers in', () => {
    expect(withAnswers(JSON.stringify(payload), { q: 'a' })).toEqual({ ...payload, answers: { q: 'a' } });
  });

  it('still produces a usable input when the original is unparseable', () => {
    expect(withAnswers('not json', { q: 'a' })).toEqual({ answers: { q: 'a' } });
    expect(withAnswers(null, { q: 'a' })).toEqual({ answers: { q: 'a' } });
  });

  it('lets the answers win over an answers key already on the input', () => {
    expect(withAnswers({ answers: { q: 'stale' } }, { q: 'fresh' })).toEqual({ answers: { q: 'fresh' } });
  });
});

describe('joinAnswer', () => {
  it('joins multi-select labels the way the tool expects', () => {
    expect(joinAnswer(['linux', 'win'])).toBe('linux, win');
    expect(joinAnswer(['linux'])).toBe('linux');
    expect(joinAnswer([])).toBe('');
  });
});

describe('answerHasLabel', () => {
  it('matches a label anywhere in a joined multi-select answer', () => {
    const sent = joinAnswer(['linux', 'macOS', 'win']);
    for (const l of ['linux', 'macOS', 'win']) expect(answerHasLabel(sent, l)).toBe(true);
  });

  it('matches a label that itself contains the separator', () => {
    expect(answerHasLabel('No, stop', 'No, stop')).toBe(true);
    expect(answerHasLabel(joinAnswer(['No, stop', 'linux']), 'No, stop')).toBe(true);
    expect(answerHasLabel(joinAnswer(['linux', 'No, stop']), 'No, stop')).toBe(true);
  });

  it('does not match a label that is only a substring of a pick', () => {
    expect(answerHasLabel('linux-arm64', 'linux')).toBe(false);
    expect(answerHasLabel('wipe /dev/sdb instead', 'wipe /dev/sdb')).toBe(false);
    expect(answerHasLabel('', 'linux')).toBe(false);
    expect(answerHasLabel('linux', '')).toBe(false);
  });
});
