import { describe, it, expect } from 'vitest';
import { formatToolLabel, truncateLines } from '@/components/ToolCallBody';

describe('formatToolLabel', () => {
  it('extracts command for Bash', () => {
    expect(formatToolLabel('Bash', '{"command":"npm run build","timeout":30000}')).toBe('npm run build');
  });

  it('extracts file_path for Read', () => {
    expect(formatToolLabel('Read', '{"file_path":"src/components/App.tsx"}')).toBe('src/components/App.tsx');
  });

  it('extracts file_path for Edit', () => {
    expect(formatToolLabel('Edit', '{"file_path":"src/app.ts","old_string":"a","new_string":"b"}')).toBe('src/app.ts');
  });

  it('extracts file_path for Write', () => {
    expect(formatToolLabel('Write', '{"file_path":"src/utils/helper.ts","content":"..."}')).toBe('src/utils/helper.ts');
  });

  it('extracts pattern for Grep with path', () => {
    expect(formatToolLabel('Grep', '{"pattern":"handleClick","path":"src/"}')).toBe('"handleClick" · src/');
  });

  it('extracts pattern for Grep without path', () => {
    expect(formatToolLabel('Grep', '{"pattern":"handleClick"}')).toBe('"handleClick"');
  });

  it('extracts pattern for Glob', () => {
    expect(formatToolLabel('Glob', '{"pattern":"**/*.tsx"}')).toBe('**/*.tsx');
  });

  it('extracts url for WebFetch', () => {
    expect(formatToolLabel('WebFetch', '{"url":"https://example.com/api"}')).toBe('https://example.com/api');
  });

  it('extracts query for WebSearch', () => {
    expect(formatToolLabel('WebSearch', '{"query":"react shiki setup"}')).toBe('react shiki setup');
  });

  it('falls back to raw input for unknown tools', () => {
    expect(formatToolLabel('Unknown', '{"foo":"bar"}')).toBe('{"foo":"bar"}');
  });

  it('falls back to raw input on invalid JSON', () => {
    expect(formatToolLabel('Bash', 'not json')).toBe('not json');
  });
});

describe('truncateLines', () => {
  it('returns full text when under limit', () => {
    const text = 'line1\nline2\nline3';
    const result = truncateLines(text, 20);
    expect(result.isTruncated).toBe(false);
    expect(result.truncated).toBe(text);
    expect(result.totalLines).toBe(3);
  });

  it('truncates text over limit', () => {
    const lines = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`);
    const text = lines.join('\n');
    const result = truncateLines(text, 20);
    expect(result.isTruncated).toBe(true);
    expect(result.truncated.split('\n').length).toBe(20);
    expect(result.totalLines).toBe(50);
  });

  it('handles empty string', () => {
    const result = truncateLines('', 20);
    expect(result.isTruncated).toBe(false);
    expect(result.truncated).toBe('');
    expect(result.totalLines).toBe(1);
  });
});
