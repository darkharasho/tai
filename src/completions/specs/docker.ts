import { CompletionSpec } from '@/completions/resolveCompletion';
const docker: CompletionSpec = {
  command: 'docker',
  subcommands: [
    { name: 'run', description: 'Create and run a new container from an image', options: [
      { names: ['-d', '--detach'], description: 'Run container in background' },
      { names: ['-p', '--publish'], description: 'Publish container ports to host', takesArg: true },
      { names: ['-e', '--env'], description: 'Set environment variables', takesArg: true },
      { names: ['-v', '--volume'], description: 'Bind mount a volume', takesArg: true },
      { names: ['--name'], description: 'Assign a name to the container', takesArg: true },
      { names: ['--rm'], description: 'Automatically remove container when it exits' },
    ] },
    { name: 'build', description: 'Build an image from a Dockerfile', options: [
      { names: ['-t', '--tag'], description: 'Name and optionally tag the image', takesArg: true },
      { names: ['-f', '--file'], description: 'Path to Dockerfile', takesArg: true },
      { names: ['--no-cache'], description: 'Do not use cache when building' },
    ] },
    { name: 'ps', description: 'List containers', options: [
      { names: ['-a', '--all'], description: 'Show all containers' },
      { names: ['-q', '--quiet'], description: 'Only display container IDs' },
    ] },
    { name: 'images', description: 'List images', options: [
      { names: ['-a', '--all'], description: 'Show all images' },
      { names: ['-q', '--quiet'], description: 'Only display image IDs' },
    ] },
    { name: 'exec', description: 'Execute a command in a running container', options: [
      { names: ['-i', '--interactive'], description: 'Keep STDIN open' },
      { names: ['-t', '--tty'], description: 'Allocate a pseudo-TTY' },
    ] },
    { name: 'pull', description: 'Download an image from a registry' },
    { name: 'push', description: 'Upload an image to a registry' },
    { name: 'compose', description: 'Define and run multi-container applications' },
    { name: 'logs', description: 'Fetch container logs', options: [
      { names: ['-f', '--follow'], description: 'Follow log output' },
      { names: ['--tail'], description: 'Number of lines to show from end', takesArg: true },
    ] },
    { name: 'stop', description: 'Stop one or more running containers' },
    { name: 'rm', description: 'Remove one or more containers', options: [
      { names: ['-f', '--force'], description: 'Force removal of running container' },
    ] },
    { name: 'rmi', description: 'Remove one or more images' },
    { name: 'inspect', description: 'Return low-level information on objects' },
    { name: 'network', description: 'Manage networks' },
    { name: 'volume', description: 'Manage volumes' },
  ],
  options: [
    { names: ['--version'], description: 'Print version' },
    { names: ['--help'], description: 'Show help' },
    { names: ['-H', '--host'], description: 'Daemon socket to connect to', takesArg: true },
  ],
};
export default docker;
