export interface McpSetup {
  readonly config: string;
  readonly location: string;
  readonly verify: string;
}

function quoteShell(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function buildMcpSetup(endpoint: string): McpSetup {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error('Enter a valid HTTPS MCP endpoint.');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('Enter a valid HTTPS MCP endpoint without embedded credentials.');
  }

  return {
    config: `codex mcp add mandate-cloud --url ${quoteShell(url.toString())} --bearer-token-env-var MANDATE_MCP_TOKEN`,
    location: 'Run this command in a terminal where Codex is installed. Set MANDATE_MCP_TOKEN in the environment used to launch Codex.',
    verify: 'Run `codex mcp list`, restart Codex, then inspect its MCP tools. The endpoint requires a valid MANDATE_MCP_TOKEN.',
  };
}
