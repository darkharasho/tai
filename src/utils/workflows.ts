// src/utils/workflows.ts
export interface Workflow {
  id: string;
  name: string;
  command: string;
  description?: string;
}

const PARAM_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

export function parseParams(command: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  let m: RegExpExecArray | null;
  PARAM_RE.lastIndex = 0;
  while ((m = PARAM_RE.exec(command)) !== null) {
    const name = m[1];
    if (!seen.has(name)) { seen.add(name); out.push(name); }
  }
  return out;
}

export function substituteParams(command: string, values: Record<string, string>): string {
  return command.replace(PARAM_RE, (whole, name) =>
    Object.prototype.hasOwnProperty.call(values, name) ? values[name] : whole);
}
