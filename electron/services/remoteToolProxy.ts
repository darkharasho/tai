import type { RemoteSshManager } from './remoteSsh';

interface ToolResult {
  output: string;
  isError: boolean;
}

const SUPPORTED_TOOLS = new Set(['Bash', 'Read', 'Write', 'Grep', 'Glob']);
const COMMAND_TIMEOUT = 30000;

export class RemoteToolProxy {
  constructor(private ssh: RemoteSshManager) {}

  async executeRemoteTool(tabId: string, toolName: string, input: Record<string, any>): Promise<ToolResult> {
    if (!SUPPORTED_TOOLS.has(toolName)) {
      return {
        output: `The "${toolName}" tool is not available on remote hosts. Use Bash with shell commands (cat, sed, tee) to accomplish file operations instead.`,
        isError: true,
      };
    }

    try {
      switch (toolName) {
        case 'Bash': return await this._execBash(tabId, input);
        case 'Read': return await this._execRead(tabId, input);
        case 'Write': return await this._execWrite(tabId, input);
        case 'Grep': return await this._execGrep(tabId, input);
        case 'Glob': return await this._execGlob(tabId, input);
        default: return { output: `Unknown tool: ${toolName}`, isError: true };
      }
    } catch (err: any) {
      return { output: `Remote execution failed: ${err.message}`, isError: true };
    }
  }

  private async _execBash(tabId: string, input: Record<string, any>): Promise<ToolResult> {
    const command = input.command as string;
    const timeout = (input.timeout as number) || COMMAND_TIMEOUT;
    const { output, exitCode } = await this.ssh.execute(tabId, command, timeout);
    return { output, isError: exitCode !== 0 };
  }

  private async _execRead(tabId: string, input: Record<string, any>): Promise<ToolResult> {
    const filePath = this._escapePath(input.file_path as string);
    let cmd = `cat -n ${filePath}`;
    if (input.offset) cmd += ` | tail -n +${input.offset}`;
    if (input.limit) cmd += ` | head -n ${input.limit}`;
    const { output, exitCode } = await this.ssh.execute(tabId, cmd, COMMAND_TIMEOUT);
    return { output, isError: exitCode !== 0 };
  }

  private async _execWrite(tabId: string, input: Record<string, any>): Promise<ToolResult> {
    const filePath = this._escapePath(input.file_path as string);
    const content = input.content as string;
    const delimiter = `TAI_EOF_${Math.random().toString(36).slice(2, 10)}`;
    const cmd = `mkdir -p $(dirname ${filePath}) && cat << '${delimiter}' > ${filePath}\n${content}\n${delimiter}`;
    const { output, exitCode } = await this.ssh.execute(tabId, cmd, COMMAND_TIMEOUT);
    return { output: output || 'File written successfully.', isError: exitCode !== 0 };
  }

  private async _execGrep(tabId: string, input: Record<string, any>): Promise<ToolResult> {
    const pattern = input.pattern as string;
    const searchPath = input.path ? this._escapePath(input.path as string) : '.';
    const flags = ['-rn'];
    if (input['-i']) flags.push('-i');
    if (input.glob) flags.push(`--include=${this._escapeArg(input.glob)}`);
    if (input.type) flags.push(`--include='*.${input.type}'`);
    const limit = input.head_limit ?? 250;
    let cmd = `grep ${flags.join(' ')} ${this._escapeArg(pattern)} ${searchPath}`;
    if (limit > 0) cmd += ` | head -n ${limit}`;
    const { output, exitCode } = await this.ssh.execute(tabId, cmd, COMMAND_TIMEOUT);
    // grep returns 1 for no matches — not an error
    return { output: output || 'No matches found.', isError: exitCode > 1 };
  }

  private async _execGlob(tabId: string, input: Record<string, any>): Promise<ToolResult> {
    const pattern = input.pattern as string;
    const searchPath = input.path ? this._escapePath(input.path as string) : '.';
    const namePattern = pattern.replace(/\*\*\//g, '').replace(/\*/g, '*');
    const cmd = `find ${searchPath} -name ${this._escapeArg(namePattern)} -type f 2>/dev/null | head -n 200 | sort`;
    const { output, exitCode } = await this.ssh.execute(tabId, cmd, COMMAND_TIMEOUT);
    return { output: output || 'No files found.', isError: exitCode !== 0 };
  }

  private _escapePath(p: string): string {
    return `'${p.replace(/'/g, "'\\''")}'`;
  }

  private _escapeArg(arg: string): string {
    return `'${arg.replace(/'/g, "'\\''")}'`;
  }
}
