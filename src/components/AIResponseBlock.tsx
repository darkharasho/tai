import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Copy, Play, Check, ChevronDown, ChevronRight, Sparkles } from 'lucide-react';
import type { AIEntry } from '@/types';

interface AIResponseBlockProps {
  id: string;
  question: string;
  entries: AIEntry[];
  content: string;
  streaming: boolean;
  onRunCommand: (command: string) => void;
  onCopy: (text: string) => void;
}

export function AIResponseBlock({ question, entries, content, streaming, onRunCommand, onCopy }: AIResponseBlockProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  const handleCopy = (text: string, idx: number) => {
    onCopy(text);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 1500);
  };

  const hasContent = entries.length > 0 || content;

  return (
    <div style={{
      margin: '8px 0',
      borderLeft: '2px solid rgba(168, 85, 247, 0.4)',
      borderRadius: '0 8px 8px 0',
      background: 'rgba(168, 85, 247, 0.06)',
      overflow: 'hidden',
      animation: 'fadeIn 0.2s ease',
    }}>
      <div
        onClick={() => setCollapsed(!collapsed)}
        style={{
          padding: '10px 14px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          cursor: 'pointer',
        }}
      >
        {collapsed ? <ChevronRight size={14} color="#a855f7" /> : <ChevronDown size={14} color="#a855f7" />}
        <Sparkles size={14} color="#a855f7" />
        <span style={{ color: '#e0e0e0', fontSize: 12 }}>{question}</span>
        {streaming && (
          <span style={{
            width: 6, height: 6, borderRadius: '50%',
            background: '#a855f7',
            animation: 'pulse 1.5s infinite',
            marginLeft: 'auto',
          }} />
        )}
      </div>

      {!collapsed && (
        <div style={{ padding: '0 14px 12px' }}>
          {!hasContent && streaming && (
            <span style={{ color: '#888', fontSize: 12 }}>Thinking...</span>
          )}

          {entries.map((entry, i) => {
            if (entry.kind === 'text' && entry.text) {
              return (
                <div key={i} className="ai-markdown" style={{ fontSize: 13, lineHeight: 1.6, color: '#bbb' }}>
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      code({ className, children, ...props }) {
                        const isBlock = className?.includes('language-');
                        if (!isBlock) {
                          return <code style={{ background: 'rgba(255,255,255,0.08)', padding: '1px 5px', borderRadius: 3, color: '#e0e0e0' }} {...props}>{children}</code>;
                        }
                        const text = String(children).trimEnd();
                        return (
                          <div style={{ position: 'relative', margin: '8px 0' }}>
                            <pre style={{ background: 'rgba(0,0,0,0.4)', padding: '10px 12px', borderRadius: 6, fontSize: 12, overflow: 'auto' }}>
                              <code {...props}>{children}</code>
                            </pre>
                            <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                              <button
                                onClick={() => onRunCommand(text)}
                                style={{
                                  display: 'flex', alignItems: 'center', gap: 4,
                                  background: 'rgba(0,255,136,0.1)', border: '1px solid rgba(0,255,136,0.3)',
                                  color: '#00ff88', padding: '3px 8px', borderRadius: 6, fontSize: 11,
                                  cursor: 'pointer', fontFamily: 'var(--font-mono)',
                                }}
                              >
                                <Play size={10} /> Run
                              </button>
                              <button
                                onClick={() => handleCopy(text, i)}
                                style={{
                                  display: 'flex', alignItems: 'center', gap: 4,
                                  background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                                  color: '#888', padding: '3px 8px', borderRadius: 6, fontSize: 11,
                                  cursor: 'pointer', fontFamily: 'var(--font-mono)',
                                }}
                              >
                                {copiedIdx === i ? <Check size={10} /> : <Copy size={10} />}
                                {copiedIdx === i ? 'Copied' : 'Copy'}
                              </button>
                            </div>
                          </div>
                        );
                      },
                    }}
                  >
                    {entry.text}
                  </ReactMarkdown>
                </div>
              );
            }

            if (entry.kind === 'tool' && entry.call) {
              const call = entry.call;
              return (
                <div key={i} style={{
                  margin: '8px 0',
                  padding: '8px 10px',
                  background: 'rgba(0,0,0,0.2)',
                  borderRadius: 6,
                  fontSize: 11,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#888' }}>
                    <span style={{ color: '#a855f7' }}>{call.name}</span>
                    {call.error && <span style={{ color: '#ef4444' }}>error</span>}
                  </div>
                  <div style={{ color: '#666', marginTop: 4 }}>{call.input}</div>
                  {call.output && (
                    <div style={{ color: '#888', marginTop: 4, maxHeight: 200, overflow: 'auto' }}>{call.output}</div>
                  )}
                </div>
              );
            }
            return null;
          })}

          {!entries.length && content && (
            <div className="ai-markdown" style={{ fontSize: 13, lineHeight: 1.6, color: '#bbb' }}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
