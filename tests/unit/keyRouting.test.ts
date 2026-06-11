// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { classifyKeyTarget } from '@/utils/keyRouting';

describe('classifyKeyTarget', () => {
  it('classifies elements inside an xterm container', () => {
    const wrap = document.createElement('div');
    wrap.className = 'xterm';
    const ta = document.createElement('textarea');
    wrap.appendChild(ta);
    document.body.appendChild(wrap);
    expect(classifyKeyTarget(ta)).toBe('xterm');
  });

  it('classifies bare input elements (card stdin, password) as input', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    expect(classifyKeyTarget(input)).toBe('input');
  });

  it('classifies textareas (the composer) and everything else as page', () => {
    const ta = document.createElement('textarea');
    document.body.appendChild(ta);
    expect(classifyKeyTarget(ta)).toBe('page');
    expect(classifyKeyTarget(document.body)).toBe('page');
    expect(classifyKeyTarget(null)).toBe('page');
  });
});
