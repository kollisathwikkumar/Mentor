import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createViemPort } from '@mandate/sdk';
import { MandateGateway } from './gateway.js';

const hexId = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const amount = z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/);

async function main(): Promise<void> {
  const gateway = new MandateGateway(createViemPort(process.env));
  const server = new McpServer({ name: 'mandate-gateway', version: '0.1.0' });

  server.registerTool('get_mandate_status', {
    description: 'Read current mandate limits and state from Monad. This tool has no side effects.',
    inputSchema: { mandateId: hexId },
  }, async ({ mandateId }) => {
    try {
      const status = await gateway.getStatus(mandateId);
      return { content: [{ type: 'text', text: JSON.stringify(status) }] };
    } catch {
      return { isError: true, content: [{ type: 'text', text: 'Mandate status lookup failed.' }] };
    }
  });

  server.registerTool('request_bounded_transfer', {
    description: 'Request one native MON transfer to the recipient fixed by the mandate. Recipient and signer are never caller inputs.',
    inputSchema: { mandateId: hexId, amount },
  }, async ({ mandateId, amount: amountMon }) => {
    try {
      const result = await gateway.requestTransfer({ mandateId, amount: amountMon });
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    } catch {
      return { isError: true, content: [{ type: 'text', text: 'Transfer request failed before a verified execution receipt.' }] };
    }
  });

  await server.connect(new StdioServerTransport());
}

main().catch(() => {
  process.stderr.write('Mandate MCP server failed to start. Check local configuration.\n');
  process.exitCode = 1;
});
