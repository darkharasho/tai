import { CompletionSpec } from '@/completions/resolveCompletion';
const cargo: CompletionSpec = {
  command: 'cargo',
  subcommands: [
    { name: 'build', description: 'Compile the current package', options: [
      { names: ['--release'], description: 'Build with optimizations' },
      { names: ['--target'], description: 'Build for the target triple', takesArg: true },
      { names: ['-p', '--package'], description: 'Package to build', takesArg: true },
      { names: ['--features'], description: 'Space-separated features to activate', takesArg: true },
      { names: ['--all-features'], description: 'Activate all available features' },
    ] },
    { name: 'run', description: 'Run a binary or example', options: [
      { names: ['--release'], description: 'Run with optimizations' },
      { names: ['--bin'], description: 'Name of the binary to run', takesArg: true },
      { names: ['--example'], description: 'Name of the example to run', takesArg: true },
    ] },
    { name: 'test', description: 'Run the tests', options: [
      { names: ['--release'], description: 'Compile tests with optimizations' },
      { names: ['--no-run'], description: 'Compile but do not run tests' },
      { names: ['-p', '--package'], description: 'Package to test', takesArg: true },
    ] },
    { name: 'check', description: 'Check the current package without building', options: [
      { names: ['-p', '--package'], description: 'Package to check', takesArg: true },
    ] },
    { name: 'add', description: 'Add dependencies to Cargo.toml', options: [
      { names: ['--dev'], description: 'Add as dev-dependency' },
      { names: ['--build'], description: 'Add as build-dependency' },
      { names: ['--features'], description: 'Features to enable', takesArg: true },
    ] },
    { name: 'remove', description: 'Remove dependencies from Cargo.toml' },
    { name: 'publish', description: 'Upload package to crates.io', options: [
      { names: ['--dry-run'], description: 'Perform all checks but do not publish' },
      { names: ['--token'], description: 'API token for crates.io', takesArg: true },
    ] },
    { name: 'clippy', description: 'Run the Clippy linter', options: [
      { names: ['--fix'], description: 'Automatically apply lint suggestions' },
      { names: ['--all-targets'], description: 'Check all targets' },
    ] },
    { name: 'fmt', description: 'Format Rust source code', options: [
      { names: ['--check'], description: 'Check formatting without writing' },
    ] },
    { name: 'doc', description: 'Build package documentation', options: [
      { names: ['--open'], description: 'Open docs in a browser after building' },
      { names: ['--no-deps'], description: 'Do not build docs for dependencies' },
    ] },
    { name: 'clean', description: 'Remove generated artifacts' },
    { name: 'update', description: 'Update dependencies in Cargo.lock' },
    { name: 'install', description: 'Install a Rust binary', options: [
      { names: ['--path'], description: 'Filesystem path to install from', takesArg: true },
      { names: ['--git'], description: 'Git URL to install from', takesArg: true },
    ] },
  ],
  options: [
    { names: ['--version'], description: 'Print version' },
    { names: ['--help'], description: 'Show help' },
    { names: ['-v', '--verbose'], description: 'Verbose output' },
    { names: ['-q', '--quiet'], description: 'Suppress output' },
  ],
};
export default cargo;
