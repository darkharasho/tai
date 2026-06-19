import { useState } from 'react';
import { createPortal } from 'react-dom';
import { parseParams, substituteParams } from '@/utils/workflows';
import type { Workflow } from '@/utils/workflows';
import styles from './WorkflowRunDialog.module.css';

interface Props {
  workflow: Workflow;
  onRun: (command: string, runNow: boolean) => void;
  onCancel: () => void;
}

export function WorkflowRunDialog({ workflow, onRun, onCancel }: Props) {
  const params = parseParams(workflow.command);
  const [values, setValues] = useState<Record<string, string>>(
    () => Object.fromEntries(params.map(p => [p, '']))
  );

  const preview = substituteParams(workflow.command, values);

  const handleKeyDown = (e: React.KeyboardEvent, idx: number) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const inputs = document.querySelectorAll<HTMLInputElement>('[data-wrd-field]');
      if (inputs.length === 0) return;
      const next = inputs[(idx + 1) % inputs.length];
      next?.focus();
    }
    if (e.key === 'Escape') onCancel();
  };

  return createPortal(
    <div className={styles.overlay} onClick={onCancel}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.title}>{workflow.name}</span>
          {workflow.description && <span className={styles.desc}>{workflow.description}</span>}
        </div>
        <div className={styles.body}>
          {params.map((p, i) => (
            <div key={p} className={styles.field}>
              <label className={styles.fieldLabel}>{p}</label>
              <input
                data-wrd-field={i}
                className={styles.fieldInput}
                value={values[p] ?? ''}
                onChange={e => setValues(v => ({ ...v, [p]: e.target.value }))}
                onKeyDown={e => handleKeyDown(e, i)}
                autoFocus={i === 0}
                placeholder={`{{${p}}}`}
              />
            </div>
          ))}
          <div className={styles.preview}>{preview}</div>
        </div>
        <div className={styles.footer}>
          <button className={styles.cancelBtn} onClick={onCancel}>Cancel</button>
          <button className={styles.insertBtn} onClick={() => onRun(preview, false)}>Insert</button>
          <button className={styles.runBtn} onClick={() => onRun(preview, true)}>Run</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
