// src/components/ToolCallBody.tsx
import React, { useState, useEffect, useRef } from 'react';
import { AlertCircle } from 'lucide-react';
import type { AIToolCall } from '@/types';
import { detectLangFromPath, highlightCode } from '@/utils/shikiHighlighter';
import styles from './ToolCallBody.module.css';

export function formatToolLabel(name: string, input: string): string {
  try {
    const parsed = JSON.parse(input);

    if (name === 'Bash' && parsed.command) return parsed.command;

    if (parsed.file_path) return parsed.file_path;

    if (parsed.pattern) {
      if (name === 'Grep') {
        const parts = [`"${parsed.pattern}"`];
        if (parsed.path) parts.push(parsed.path);
        else if (parsed.type) parts.push(parsed.type);
        return parts.join(' · ');
      }
      return parsed.pattern;
    }

    if (parsed.url) return parsed.url;
    if (parsed.query) return parsed.query;

    return input;
  } catch {
    return input;
  }
}

export function truncateLines(text: string, max: number): { truncated: string; isTruncated: boolean; totalLines: number } {
  const lines = text.split('\n');
  const totalLines = lines.length;
  if (totalLines <= max) return { truncated: text, isTruncated: false, totalLines };
  return { truncated: lines.slice(0, max).join('\n'), isTruncated: true, totalLines };
}

export default function ToolCallBody({ call }: { call: AIToolCall }) {
  return null;
}
