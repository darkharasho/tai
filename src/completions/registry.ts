// src/completions/registry.ts
import { CompletionSpec } from '@/completions/resolveCompletion';
import git from '@/completions/specs/git';
import docker from '@/completions/specs/docker';
import npm from '@/completions/specs/npm';
import kubectl from '@/completions/specs/kubectl';
import cargo from '@/completions/specs/cargo';

const SPECS: Record<string, CompletionSpec> = {
  git, docker, npm, kubectl, cargo,
};

export function getSpec(command: string): CompletionSpec | null {
  return SPECS[command] ?? null;
}
