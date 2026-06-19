import { CompletionSpec } from '@/completions/resolveCompletion';
const npm: CompletionSpec = {
  command: 'npm',
  subcommands: [
    { name: 'install', description: 'Install package dependencies', options: [
      { names: ['-g', '--global'], description: 'Install package globally' },
      { names: ['--save-dev'], description: 'Save to devDependencies' },
      { names: ['--save-exact'], description: 'Save exact version' },
      { names: ['--legacy-peer-deps'], description: 'Ignore peer deps conflicts' },
    ] },
    { name: 'run', description: 'Run a package script', options: [
      { names: ['--if-present'], description: 'Only run if script exists' },
    ] },
    { name: 'test', description: 'Run the test script' },
    { name: 'start', description: 'Run the start script' },
    { name: 'build', description: 'Run the build script' },
    { name: 'init', description: 'Create a new package.json', options: [
      { names: ['-y', '--yes'], description: 'Skip prompts with defaults' },
    ] },
    { name: 'publish', description: 'Publish package to the registry', options: [
      { names: ['--access'], description: 'Package access level', takesArg: true },
      { names: ['--tag'], description: 'Publish tag', takesArg: true },
    ] },
    { name: 'update', description: 'Update packages' },
    { name: 'ci', description: 'Clean install from package-lock.json' },
    { name: 'uninstall', description: 'Remove a package', options: [
      { names: ['-g', '--global'], description: 'Remove global package' },
    ] },
    { name: 'list', description: 'List installed packages', options: [
      { names: ['--depth'], description: 'Max dependency depth', takesArg: true },
    ] },
    { name: 'outdated', description: 'Check for outdated packages' },
    { name: 'audit', description: 'Run security audit', options: [
      { names: ['--fix'], description: 'Automatically fix vulnerabilities' },
    ] },
    { name: 'pack', description: 'Create a tarball from a package' },
    { name: 'link', description: 'Create a symlink to local package' },
  ],
  options: [
    { names: ['--version'], description: 'Print version' },
    { names: ['--help'], description: 'Show help' },
  ],
};
export default npm;
