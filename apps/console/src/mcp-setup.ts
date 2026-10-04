export type McpClient = 'codex' | 'cursor' | 'claude-code';

export interface McpSetup {
  readonly config: string;
  readonly location: string;
  readonly verify: string;
}

function quoteShell(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function assertAbsolutePath(path: string): void {
  if (!path.startsWith('/') || path.trim() !== path || /[\r\n\0]/.test(path)) {
    throw new Error('Enter an absolute project folder path.');
  }
}

export function buildMcpSetup(client: McpClient, projectPath: string): McpSetup {
  assertAbsolutePath(projectPath);
  const args = ['--prefix', projectPath, 'run', 'start', '--workspace', '@mandate/mcp-server'];

  if (client === 'codex') {
    return {
      config: `codex mcp add mandate -- npm ${args.map(quoteShell).join(' ')}`,
      location: 'Run this command in a terminal; Codex saves the local server entry in ~/.codex/config.toml.',
      verify: 'Run `codex mcp list`, then restart Codex and inspect the available Mandate tools.',
    };
  }

  if (client === 'cursor') {
    return {
      config: JSON.stringify({ mcpServers: { mandate: { command: 'npm', args } } }, null, 2),
      location: 'Add this entry to your Cursor MCP configuration (usually ~/.cursor/mcp.json).',
      verify: 'Restart Cursor, open Agent tools, and check that Mandate tools appear.',
    };
  }

  const command = `claude mcp add --scope user mandate -- npm ${args.map(quoteShell).join(' ')}`;
  return {
    config: command,
    location: 'Run this command in a terminal where Claude Code is installed.',
    verify: 'Run `claude mcp list`, then use `/mcp` in Claude Code to confirm the server is connected.',
  };
}
