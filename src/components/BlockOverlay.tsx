import type { DisplayItem, SegmentedBlock } from '@/types';
import { AIResponseBlock } from './AIResponseBlock';
import { AgentStepCard } from './AgentStepCard';
import { ApprovalPrompt } from './ApprovalPrompt';
import { ErrorAffordance } from './ErrorAffordance';

interface BlockOverlayProps {
  items: DisplayItem[];
  onRunCommand: (command: string) => void;
  onCopy: (text: string) => void;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onEdit: (id: string) => void;
  onAskAI: (block: SegmentedBlock) => void;
}

export function BlockOverlay({ items, onRunCommand, onCopy, onApprove, onReject, onEdit, onAskAI }: BlockOverlayProps) {
  if (items.length === 0) return null;

  return (
    <div style={{ padding: '0 8px' }}>
      {items.map(item => {
        switch (item.type) {
          case 'ai':
            return (
              <AIResponseBlock
                key={item.id}
                id={item.id}
                question={item.question}
                entries={item.entries}
                content={item.content}
                streaming={item.streaming}
                onRunCommand={onRunCommand}
                onCopy={onCopy}
              />
            );
          case 'agent':
            return (
              <AgentStepCard
                key={item.id}
                id={item.id}
                question={item.question}
                steps={item.steps}
                streaming={item.streaming}
              />
            );
          case 'approval':
            return (
              <ApprovalPrompt
                key={item.id}
                id={item.id}
                command={item.command}
                status={item.status}
                onApprove={() => onApprove(item.id)}
                onReject={() => onReject(item.id)}
                onEdit={() => onEdit(item.id)}
              />
            );
          case 'error-affordance':
            return (
              <ErrorAffordance
                key={item.id}
                block={item.block}
                onAskAI={onAskAI}
              />
            );
          default:
            return null;
        }
      })}
    </div>
  );
}
