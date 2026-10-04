import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMandateMcpServer } from './create-server.js';

async function main(): Promise<void> {
  const server = createMandateMcpServer(process.env);
  await server.connect(new StdioServerTransport());
}

main().catch(() => {
  process.stderr.write('Mandate MCP server failed to start. Check local configuration.\n');
  process.exitCode = 1;
});
