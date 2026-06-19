import { CompletionSpec } from '@/completions/resolveCompletion';
const git: CompletionSpec = {
  command: 'git',
  subcommands: [
    { name: 'add', description: 'Stage changes' },
    { name: 'checkout', description: 'Switch branches or restore files' },
    { name: 'cherry-pick', description: 'Apply existing commits' },
    { name: 'commit', description: 'Record staged changes', options: [
      { names: ['-m', '--message'], description: 'Commit message', takesArg: true },
      { names: ['-a', '--all'], description: 'Stage tracked changes' },
      { names: ['--amend'], description: 'Amend the previous commit' },
    ] },
    { name: 'push', description: 'Update remote refs' },
    { name: 'pull', description: 'Fetch and integrate' },
    { name: 'status', description: 'Show working tree status' },
    { name: 'log', description: 'Show commit logs' },
    { name: 'branch', description: 'List/create/delete branches' },
    { name: 'rebase', description: 'Reapply commits on top of another base' },
    { name: 'stash', description: 'Stash changes' },
    { name: 'diff', description: 'Show changes' },
    { name: 'restore', description: 'Restore working tree files' },
    { name: 'switch', description: 'Switch branches' },
    { name: 'remote', description: 'Manage remotes' },
    { name: 'fetch', description: 'Download objects and refs' },
  ],
  options: [{ names: ['--version'], description: 'Print version' }, { names: ['--help'], description: 'Show help' }],
};
export default git;
