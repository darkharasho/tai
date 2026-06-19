import { CompletionSpec } from '@/completions/resolveCompletion';
const kubectl: CompletionSpec = {
  command: 'kubectl',
  subcommands: [
    { name: 'get', description: 'Display one or many resources', options: [
      { names: ['-n', '--namespace'], description: 'Namespace', takesArg: true },
      { names: ['-o', '--output'], description: 'Output format', takesArg: true },
      { names: ['-A', '--all-namespaces'], description: 'All namespaces' },
      { names: ['-l', '--selector'], description: 'Label selector', takesArg: true },
    ] },
    { name: 'describe', description: 'Show details of a specific resource', options: [
      { names: ['-n', '--namespace'], description: 'Namespace', takesArg: true },
    ] },
    { name: 'apply', description: 'Apply a configuration to a resource', options: [
      { names: ['-f', '--filename'], description: 'Filename or directory', takesArg: true },
      { names: ['-n', '--namespace'], description: 'Namespace', takesArg: true },
      { names: ['--dry-run'], description: 'Dry run mode', takesArg: true },
    ] },
    { name: 'delete', description: 'Delete resources', options: [
      { names: ['-f', '--filename'], description: 'Filename or directory', takesArg: true },
      { names: ['-n', '--namespace'], description: 'Namespace', takesArg: true },
      { names: ['--force'], description: 'Force immediate deletion' },
    ] },
    { name: 'logs', description: 'Print logs for a container', options: [
      { names: ['-f', '--follow'], description: 'Follow log stream' },
      { names: ['-n', '--namespace'], description: 'Namespace', takesArg: true },
      { names: ['--tail'], description: 'Lines to show from end', takesArg: true },
      { names: ['-c', '--container'], description: 'Container name', takesArg: true },
    ] },
    { name: 'exec', description: 'Execute a command in a container', options: [
      { names: ['-i', '--stdin'], description: 'Pass stdin to container' },
      { names: ['-t', '--tty'], description: 'Allocate a TTY' },
      { names: ['-n', '--namespace'], description: 'Namespace', takesArg: true },
      { names: ['-c', '--container'], description: 'Container name', takesArg: true },
    ] },
    { name: 'scale', description: 'Set a new size for a deployment/replica set', options: [
      { names: ['--replicas'], description: 'Number of replicas', takesArg: true },
      { names: ['-n', '--namespace'], description: 'Namespace', takesArg: true },
    ] },
    { name: 'rollout', description: 'Manage rollouts', subcommands: [
      { name: 'status', description: 'Show rollout status' },
      { name: 'history', description: 'View rollout history' },
      { name: 'undo', description: 'Undo a previous rollout' },
      { name: 'restart', description: 'Restart a resource' },
    ] },
    { name: 'create', description: 'Create a resource from a file or stdin', options: [
      { names: ['-f', '--filename'], description: 'Filename or directory', takesArg: true },
    ] },
    { name: 'edit', description: 'Edit a resource in the default editor' },
    { name: 'config', description: 'Modify kubeconfig files', subcommands: [
      { name: 'get-contexts', description: 'Describe one or many contexts' },
      { name: 'use-context', description: 'Set the current context', options: [
        { names: ['--namespace'], description: 'Namespace', takesArg: true },
      ] },
      { name: 'current-context', description: 'Display the current context' },
      { name: 'set-context', description: 'Set a context entry in kubeconfig' },
    ] },
    { name: 'port-forward', description: 'Forward local port to a pod', options: [
      { names: ['-n', '--namespace'], description: 'Namespace', takesArg: true },
    ] },
    { name: 'top', description: 'Display resource CPU/memory usage' },
  ],
  options: [
    { names: ['--version'], description: 'Print version' },
    { names: ['--help'], description: 'Show help' },
    { names: ['--context'], description: 'Kubeconfig context to use', takesArg: true },
    { names: ['--kubeconfig'], description: 'Path to kubeconfig file', takesArg: true },
  ],
};
export default kubectl;
