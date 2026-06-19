import { app, ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { Workflow } from '../../src/utils/workflows';

export const MAX_WORKFLOWS = 500;
const file = () => path.join(app.getPath('userData'), 'workflows.json');

export function serializeWorkflows(list: Workflow[]): string {
  return JSON.stringify(list);
}

function isWorkflow(w: any): w is Workflow {
  return w && typeof w.id === 'string' && typeof w.name === 'string' && typeof w.command === 'string';
}

export function deserializeWorkflows(raw: string | null): Workflow[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isWorkflow).slice(0, MAX_WORKFLOWS);
  } catch {
    return [];
  }
}

export function loadWorkflows(): Workflow[] {
  let raw: string | null = null;
  try { raw = fs.readFileSync(file(), 'utf-8'); } catch { raw = null; }
  return deserializeWorkflows(raw);
}

export function saveWorkflows(list: Workflow[]): void {
  try { fs.writeFileSync(file(), serializeWorkflows(list.slice(0, MAX_WORKFLOWS)), { mode: 0o600 }); } catch { /* best effort */ }
}

export function registerWorkflowIpc(): void {
  ipcMain.handle('workflows:get', () => loadWorkflows());
  ipcMain.on('workflows:set', (_e, list: Workflow[]) => saveWorkflows(list));
}
