import { describe, it, expect } from 'vitest';
import { detectLangFromPath } from '@/utils/shikiHighlighter';

describe('detectLangFromPath', () => {
  it('detects TypeScript files', () => {
    expect(detectLangFromPath('src/app.ts')).toBe('typescript');
    expect(detectLangFromPath('src/app.tsx')).toBe('typescript');
  });

  it('detects JavaScript files', () => {
    expect(detectLangFromPath('src/app.js')).toBe('javascript');
    expect(detectLangFromPath('src/app.jsx')).toBe('javascript');
  });

  it('detects Python files', () => {
    expect(detectLangFromPath('script.py')).toBe('python');
  });

  it('detects JSON files', () => {
    expect(detectLangFromPath('package.json')).toBe('json');
  });

  it('detects CSS files', () => {
    expect(detectLangFromPath('styles.css')).toBe('css');
  });

  it('detects shell scripts', () => {
    expect(detectLangFromPath('run.sh')).toBe('bash');
    expect(detectLangFromPath('run.bash')).toBe('bash');
  });

  it('detects markdown', () => {
    expect(detectLangFromPath('README.md')).toBe('markdown');
  });

  it('detects YAML', () => {
    expect(detectLangFromPath('config.yaml')).toBe('yaml');
    expect(detectLangFromPath('config.yml')).toBe('yaml');
  });

  it('detects Rust and Go', () => {
    expect(detectLangFromPath('main.rs')).toBe('rust');
    expect(detectLangFromPath('main.go')).toBe('go');
  });

  it('detects HTML', () => {
    expect(detectLangFromPath('index.html')).toBe('html');
  });

  it('returns text for unknown extensions', () => {
    expect(detectLangFromPath('file.xyz')).toBe('text');
    expect(detectLangFromPath('noext')).toBe('text');
  });
});
